"""
운동 추적 및 벌금 계산 시스템

카카오톡 채팅 로그(gym_log.txt)를 파싱하여 멤버별 주간 운동 횟수를 추적하고,
미달 시 벌금을 자동 계산·누적합니다.

규칙:
    - 주 3회 운동 목표
    - 0회: 15,000원 / 1회: 10,000원 / 2회: 5,000원 / 3회+: 0원
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from members import HEALTHFAM_MEMBERS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GYM_LOG_PATH = os.path.join(BASE_DIR, "gym_log.txt")
PENALTY_FILE = os.path.join(BASE_DIR, "penalty_list.txt")
TOTAL_PENALTY_FILE = os.path.join(BASE_DIR, "total_penalty.txt")


def parse_chat_log(log_text):
    """
    채팅 로그를 파싱하여 각 사람의 운동 횟수를 추출합니다.
    """
    # 채팅 로그에서 운동 횟수를 추출하기 위한 패턴
    # 1. "이름: N/3" 형식 (요약 리스트에 있는 형식)
    summary_pattern = re.compile(r"([가-힣]+): (\d+)/3")

    # 2. "오후/오전 시간 이름 N/3" 형식 (개별 메시지 형식)
    message_pattern = re.compile(r"(?:오[전후] \d+:\d+ )?([가-힣]+) (\d+)/3")

    lines = log_text.strip().split("\n")
    latest_workout_counts = {}

    for line in lines:
        # 요약 리스트 형식 확인
        summary_matches = summary_pattern.findall(line)
        if summary_matches:
            for name, count in summary_matches:
                latest_workout_counts[name] = int(count)
        else:
            # 개별 메시지 형식 확인
            message_matches = message_pattern.findall(line)
            for name, count in message_matches:
                latest_workout_counts[name] = int(count)

    return latest_workout_counts


def calculate_penalties(workout_counts):
    """
    운동 횟수에 따라 벌금을 계산합니다.
    """
    penalties = {}

    for person, count in workout_counts.items():
        if count >= 3 or count == -1:
            penalties[person] = 0
        else:
            penalties[person] = 15000 - 5000 * count

    return penalties


def generate_workout_summary(workout_counts):
    """
    각 사람의 운동 상태를 요약합니다.
    """
    workout_text = []
    for person, num in sorted(workout_counts.items()):
        if num == -1:
            workout_text.append(f"{person}: 0/0")
        else:
            workout_text.append(f"{person}: {num}/3")

    return workout_text


def generate_penalty_summary(penalties, member_order):
    """
    벌금 정보를 그룹화하여 요약합니다.
    """
    penalty_groups = {5000: [], 10000: [], 15000: []}

    for person, fine in penalties.items():
        if fine > 0:
            penalty_groups[fine].append(person)

    penalty_text = []

    for fine in [5000, 10000, 15000]:
        if penalty_groups[fine]:
            names = sorted(penalty_groups[fine], key=lambda name: member_order.index(name))
            if len(names) > 1:
                penalty_text.append(f"{' '.join(names)} {fine}원씩")
            else:
                penalty_text.append(f"{' '.join(names)} {fine}원")

    if penalty_text:
        return "벌금 " + " ".join(penalty_text)
    else:
        return "벌금 없음"


def update_penalty_records(penalties):
    """
    개인별 벌금 기록을 업데이트합니다.
    """
    penalty_totals = {}

    if os.path.exists(PENALTY_FILE):
        with open(PENALTY_FILE, "r", encoding="utf-8") as file:
            for line in file:
                parts = line.strip().split(": ")
                if len(parts) == 2:
                    person, amount = parts
                    penalty_totals[person] = int(amount.replace(",", "").replace("원", ""))

    for person, fine in penalties.items():
        if fine > 0:
            if person in penalty_totals:
                penalty_totals[person] += fine
            else:
                penalty_totals[person] = fine

    with open(PENALTY_FILE, "w", encoding="utf-8") as file:
        for person, total_fine in sorted(penalty_totals.items()):
            formatted_fine = f"{total_fine:,}원"
            file.write(f"{person}: {formatted_fine}\n")

    return penalty_totals


def update_total_penalty(penalties):
    """
    총 벌금 금액을 업데이트합니다.
    """
    if os.path.exists(TOTAL_PENALTY_FILE):
        with open(TOTAL_PENALTY_FILE, "r", encoding="utf-8") as file:
            content = file.read().strip()
            total_penalty = int(content) if content else 0
    else:
        total_penalty = 0

    current_total_penalty = sum(penalties.values())
    total_penalty += current_total_penalty

    with open(TOTAL_PENALTY_FILE, "w", encoding="utf-8") as file:
        file.write(str(total_penalty))

    return total_penalty


def main():
    """
    메인 함수 - gym_log.txt 파일에서 채팅 로그를 읽어오고 결과를 출력합니다.
    """
    print("운동 추적 및 벌금 계산 프로그램을 시작합니다.")

    try:
        with open(GYM_LOG_PATH, "r", encoding="utf-8") as file:
            chat_log = file.read()
        print("gym_log.txt 파일을 성공적으로 불러왔습니다.")
    except FileNotFoundError:
        print("Error: gym_log.txt 파일을 찾을 수 없습니다.")
        return
    except Exception as e:
        print(f"Error: 파일을 읽는 중 오류가 발생했습니다: {e}")
        return

    # 채팅 로그에서 운동 횟수 추출
    workout_counts = parse_chat_log(chat_log)

    # config에서 가져온 멤버 목록으로 기본값 설정
    for member in HEALTHFAM_MEMBERS:
        if member not in workout_counts:
            workout_counts[member] = 0

    # 멤버 목록에 있는 사람만 남기기
    workout_counts = {name: count for name, count in workout_counts.items() if name in HEALTHFAM_MEMBERS}

    # 벌금 계산
    penalties = calculate_penalties(workout_counts)

    # 운동 요약 생성 및 출력
    workout_summary = generate_workout_summary(workout_counts)
    for line in workout_summary:
        print(line)
    print()

    # 벌금 요약 생성 및 출력
    penalty_summary = generate_penalty_summary(penalties, HEALTHFAM_MEMBERS)
    print(penalty_summary)

    # 개인별 벌금 기록 업데이트
    update_penalty_records(penalties)

    # 총 벌금 업데이트 및 출력
    total_penalty = update_total_penalty(penalties)
    formatted_total_penalty = f"{total_penalty:,}원"
    print(f"총금액: {formatted_total_penalty}")


if __name__ == "__main__":
    main()