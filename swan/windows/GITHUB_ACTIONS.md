# GitHub Actions 로 SWAN 빌드하기

워크플로: `.github/workflows/swan-windows-build.yml`(빌드, 수동 실행), `swan-ts-tests.yml`(UI 테스트, 자동). 🧪 GitHub 에서 실행해 본 적 없음.

## 1. 서버 → GitHub 전송 (비공개 저장소 필수)
소스 전체(약 49만 파일, 압축 후 ≈1.2GB)가 올라간다. **반드시 Private 저장소**로 만든다.
GitHub 는 파일당 100MB·한 번의 push 약 2GB 를 넘기면 거부하므로 **나눠서 push** 한다:
```
cd /home/chromium/project-A
git remote add origin https://github.com/<계정>/<저장소>.git
# 디렉터리 묶음 단위로 커밋+push (각 묶음 < 1.5GB)
git add .github .gitignore swan AGENT.md && git commit -m "SWAN: workflows, docs" && git push -u origin HEAD:main
git add chrome components content && git commit -m "part 1" && git push
git add third_party/blink && git commit -m "part 2" && git push
git add -A && git commit -m "rest" && git push
```
인증: 개인 액세스 토큰(PAT, 이 저장소에 한정된 Contents: write)을 `git push` 비밀번호로 쓴다. 토큰은 채팅에 붙여넣지 말고 서버에서 직접 입력한다.

## 2. 러너
- **권장: self-hosted(사용자 Windows PC).** 저장소 Settings → Actions → Runners → New self-hosted runner(Windows x64) 안내대로 설치, 라벨 `self-hosted, windows, x64`. 작업 폴더가 유지되어 재실행 시 증분 빌드. 요구: RAM 32GB+, 디스크 150GB+, VS(C++ 데스크톱·ATL·MFC·Windows SDK·디버깅 도구), Git.
- 호스티드 `windows-2022`(4코어)는 6시간 제한 때문에 **전체 빌드가 끝나지 않는다.** 유료 larger runner(32코어+)라면 라벨을 만들어 실행 시 입력.
- 비공개 저장소의 호스티드 러너는 분 단위 과금(Windows 배율 2배)이다 — 6시간 실패를 반복하지 말 것.

## 3. 실행
Actions 탭 → `swan-windows-build` → Run workflow → `runner` 에 JSON 라벨 입력. 완료되면 산출물 `swan-win-x64`(zip, 14일 보관)를 내려받아 `swan.exe` 실행.

## 4. 알려진 위험
- `lastchange`: 스냅샷 저장소라 upstream 정보가 없어 워크플로가 LASTCHANGE 를 직접 쓴다.
- 러너 PC 에 `.gclient` 가 이미 있으면 덮어쓰지 않음(작업 폴더 기준).
- `swan.exe` 이름 변경 그룹은 링크·실행 미검증 — 산출물 단계에서 없으면 실패하도록 해 두었다.
- `.github/workflows/close-pull-request.yml`(upstream)은 그대로 두었다(PR 자동 종료). 필요 없으면 삭제.
