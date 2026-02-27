#!/bin/bash
# Stop Hook - 세션 종료 시 정리
# NOTE: viewer 서버는 여기서 죽이지 않음!
# - 서버는 10분 idle 시 auto-shutdown
# - 수동 종료는 /server off
# - Stop hook은 매 턴 종료마다 트리거되므로 서버를 죽이면 안됨

echo '{"continue": true}'
exit 0
