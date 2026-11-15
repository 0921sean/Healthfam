"""
헬스팸 자동 정산

맥 카카오톡의 로컬 DB에서 직전 주(월~일) 채팅을 읽어 멤버별 운동 횟수를 집계하고,
정산 결과를 헬스팸 방에 올립니다. 아직 정산하지 않은 주가 여러 개면 오래된 주부터 차례로 처리합니다.

    python3 healthfam_auto.py --dry-run   # 계산만 하고 출력 (전송·기록 없음)
    python3 healthfam_auto.py --to-self   # 나와의 채팅으로 전송 (기록 없음)
    python3 healthfam_auto.py             # 헬스팸 방에 전송하고 벌금 기록 갱신

읽기: 예약 작업 com.makestory.healthfam.dump 가 kakaocli로 방의 메시지를 파일로 뽑고, 이 스크립트는 그 파일만 읽습니다.
      (macOS가 카카오톡 DB 접근 권한을 kakaocli에만 인정하기 때문에 Python이 kakaocli를 직접 부르면 허용 창이 뜹니다.)
전송: kmsg-safe (카카오톡 화면 자동화)

면제: 아프거나 해서 그 주 정산에서 빼 줄 사람은 exemptions.txt 에 한 줄씩 적습니다. (형식: "YYYY-MM-DD 이름 [이름 ...]  # 사유")
      날짜는 그 주에 속한 아무 날이나 됩니다. 면제된 사람은 "이름: 0/0"으로 표시되고 벌금이 없습니다.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from members import HEALTHFAM_MEMBERS
from healthfam import (
    calculate_penalties,
    generate_penalty_summary,
    generate_workout_summary,
    update_penalty_records,
    update_total_penalty,
    TOTAL_PENALTY_FILE,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(BASE_DIR, "last_settled_week.txt")  # 마지막으로 정산한 주의 월요일 (YYYY-MM-DD)
LOG_FILE = os.path.join(BASE_DIR, "auto_settle.log")
EXEMPT_FILE = os.path.join(BASE_DIR, "exemptions.txt")  # 주차별 면제자
EXEMPT = -1  # healthfam.py 가 "0/0", 벌금 0원으로 처리하는 값

DUMP_JOB = "com.makestory.healthfam.dump"
DUMP_FILE = os.path.expanduser("~/.kakaocli/healthfam_dump.json")
KMSG = os.path.expanduser("~/.local/bin/kmsg-safe")  # 여러 줄 메시지를 쪼개 보내지 않도록 고친 kmsg

KMSG_ROOM = "chat_8d04051528a9"  # 헬스팸 방 (kmsg chat_id)
KMSG_SELF = "chat_b34bc169f9ec"  # 나와의 채팅 (kmsg chat_id)

TEXT_TYPES = (1, 26)  # 일반 메시지, 답장
COUNT_PATTERN = re.compile(r"\s*(\d+)\s*/\s*3")


def log(msg):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_dump():
    """추출 작업을 실행하고 결과를 읽는다. (방의 최신 logId, logId순 메시지 목록) 반환.

    메시지 한 건: (logId, prevId, sentAt, type, 작성자 이름, 내용)
    """
    with open(DUMP_FILE, "w"):
        pass  # launchd는 출력 파일에 이어 쓰므로 먼저 비운다
    target = f"gui/{os.getuid()}/{DUMP_JOB}"
    result = subprocess.run(["launchctl", "kickstart", target], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"추출 작업 실행 실패: {result.stderr.strip()[:200]}")
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(0.5)
        try:
            with open(DUMP_FILE, encoding="utf-8") as f:
                rows = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        room_last = next((r[1] for r in rows if r[0] == "room"), None)
        messages = sorted((tuple(r[1:]) for r in rows if r[0] == "msg"), key=lambda m: m[0])
        return room_last, messages
    raise RuntimeError("추출 결과를 30초 안에 받지 못함 (kakaocli의 전체 디스크 접근 권한 확인 필요)")


def monday_of(day):
    return day - datetime.timedelta(days=day.weekday())


def pending_weeks(today):
    """아직 정산하지 않은, 이미 끝난 주들의 월요일 목록."""
    with open(STATE_FILE, encoding="utf-8") as f:
        last = datetime.date.fromisoformat(f.read().strip())
    weeks = []
    week = last + datetime.timedelta(days=7)
    while week + datetime.timedelta(days=7) <= today:
        weeks.append(week)
        week += datetime.timedelta(days=7)
    return weeks


def week_bounds(week):
    start = int(datetime.datetime.combine(week, datetime.time()).timestamp())
    end = int(datetime.datetime.combine(week + datetime.timedelta(days=7), datetime.time()).timestamp())
    return start, end


def check_db_complete(room_last, messages, week):
    """해당 주 시작 2주 전부터 지금까지 방의 메시지가 빠짐없이 있는지 확인."""
    start, _ = week_bounds(week)
    recent = [m for m in messages if m[2] >= start - 14 * 86400]
    if not recent:
        return "해당 기간 메시지가 DB에 하나도 없음"
    ids = {m[0] for m in recent}
    breaks = [m for m in recent if m[1] not in ids]
    if len(breaks) > 1:  # 가장 오래된 메시지 하나만 앞이 끊겨 있어야 정상
        return f"메시지 연결이 {len(breaks) - 1}군데 끊겨 있음 (동기화 안 된 구간)"
    if room_last is not None and room_last != recent[-1][0]:
        return "방의 최신 메시지가 아직 DB에 없음"
    return None


def load_exemptions():
    """exemptions.txt 를 읽어 {주의 월요일: {이름, ...}} 로 돌려준다. 형식이 틀리면 정산을 멈춘다."""
    exemptions = {}
    if not os.path.exists(EXEMPT_FILE):
        return exemptions
    with open(EXEMPT_FILE, encoding="utf-8") as f:
        for number, raw in enumerate(f, 1):
            parts = raw.split("#", 1)[0].split()
            if not parts:
                continue
            try:
                week = monday_of(datetime.date.fromisoformat(parts[0]))
            except ValueError:
                raise RuntimeError(f"exemptions.txt {number}번째 줄: 날짜 형식이 잘못됨 ({parts[0]})")
            names = parts[1:]
            unknown = [name for name in names if name not in HEALTHFAM_MEMBERS]
            if not names or unknown:
                raise RuntimeError(f"exemptions.txt {number}번째 줄: 멤버 이름 확인 필요 ({' '.join(unknown) or '이름 없음'})")
            exemptions.setdefault(week, set()).update(names)
    return exemptions


def count_week(messages, week, exempt=()):
    """한 주(월 00:00 ~ 다음 월 00:00)의 멤버별 운동 횟수. 멤버가 마지막으로 올린 N/3의 N. 면제자는 EXEMPT."""
    start, end = week_bounds(week)
    in_week = sorted((m for m in messages if start <= m[2] < end and m[3] in TEXT_TYPES), key=lambda m: (m[2], m[0]))
    counts = {member: 0 for member in HEALTHFAM_MEMBERS}
    for _, _, _, _, name, message in in_week:
        match = COUNT_PATTERN.match(message or "")
        if match and name in counts:
            counts[name] = int(match.group(1))
    for name in exempt:
        counts[name] = EXEMPT
    return counts, len(in_week)


def build_message(counts, total_penalty):
    penalties = calculate_penalties(counts)
    lines = generate_workout_summary(counts)
    lines.append("")
    lines.append(generate_penalty_summary(penalties, HEALTHFAM_MEMBERS))
    lines.append(f"총금액: {total_penalty + sum(penalties.values()):,}원")
    return "\n".join(lines), penalties


def read_total():
    if not os.path.exists(TOTAL_PENALTY_FILE):
        return 0
    with open(TOTAL_PENALTY_FILE, encoding="utf-8") as f:
        content = f.read().strip()
    return int(content) if content else 0


def send(chat_id, text):
    result = subprocess.run([KMSG, "send", "--chat-id", chat_id, text], capture_output=True, text=True, timeout=120)
    output = (result.stdout + result.stderr).strip()
    if result.returncode != 0 or "Message sent" not in output:
        raise RuntimeError(f"kmsg 전송 실패: {output[-300:]}")


def already_posted(messages, text, week):
    """같은 정산 메시지가 그 주가 끝난 뒤 방에 이미 올라와 있는지 (전송은 됐는데 실패로 보고된 경우 대비)."""
    _, end = week_bounds(week)
    return any(m[2] >= end and (m[5] or "").strip() == text.strip() for m in messages)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="계산 결과만 출력")
    parser.add_argument("--to-self", action="store_true", help="나와의 채팅으로 전송하고 기록은 갱신하지 않음")
    parser.add_argument("--week", help="테스트용: 정산 상태와 무관하게 이 주(월요일, YYYY-MM-DD)를 계산. --dry-run/--to-self 전용")
    args = parser.parse_args()

    if args.week:
        if not (args.dry_run or args.to_self):
            parser.error("--week 는 --dry-run 또는 --to-self 와 함께만 쓸 수 있습니다")
        weeks = [monday_of(datetime.date.fromisoformat(args.week))]
    else:
        weeks = pending_weeks(datetime.date.today())
    if not weeks:
        return

    room_last, messages = load_dump()
    problem = check_db_complete(room_last, messages, weeks[0])
    if problem and not args.dry_run:
        # 방을 한 번 열어 카카오톡이 밀린 메시지를 받아오게 한 뒤 다시 확인
        subprocess.run([KMSG, "read", "--chat-id", KMSG_ROOM, "--limit", "5"], capture_output=True, timeout=120)
        time.sleep(10)
        room_last, messages = load_dump()
        problem = check_db_complete(room_last, messages, weeks[0])
    if problem:
        log(f"중단: {problem}. 다음 실행 때 다시 시도합니다.")
        sys.exit(1)

    total = read_total()
    exemptions = load_exemptions()
    for week in weeks:
        exempt = sorted(exemptions.get(week, ()))
        counts, message_count = count_week(messages, week, exempt)
        text, penalties = build_message(counts, total)
        label = f"{week:%m.%d}~{week + datetime.timedelta(days=6):%m.%d} 주차"
        if args.dry_run:
            print(f"--- {label} (메시지 {message_count}개) ---\n{text}\n")
            total += sum(penalties.values())
            continue
        if args.to_self:
            send(KMSG_SELF, f"[테스트] {label}\n{text}")
            log(f"{label} 나와의 채팅으로 테스트 전송")
            total += sum(penalties.values())
            continue
        if already_posted(messages, text, week):
            log(f"{label} 정산 메시지가 이미 방에 있어 전송은 건너뜀")
        else:
            send(KMSG_ROOM, text)
        update_penalty_records(penalties)
        total = update_total_penalty(penalties)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            f.write(week.isoformat() + "\n")
        log(f"{label} 정산 전송 완료 (총금액 {total:,}원)" + (f", 면제: {' '.join(exempt)}" if exempt else ""))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # 실패 시 기록만 남기고 다음 실행에서 재시도
        log(f"오류: {e}")
        sys.exit(1)
