# GitHub Actions 로 SWAN 빌드하기

워크플로: `.github/workflows/swan-windows-build.yml`(빌드, 수동/훅 실행), `swan-ts-tests.yml`(UI 테스트, 자동). 🧪 GitHub 에서 실행해 본 적 없음.

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
- **권장: self-hosted(사용자 Windows PC).** 저장소 Settings → Actions → Runners → New self-hosted runner(Windows x64) 안내대로 설치, 라벨 `self-hosted, windows, x64`. 작업 폴더는 유지되어 증분 빌드 지원.
- 호스티드 `windows-2022`(4코어)는 6시간 제한 때문에 **전체 빌드가 끝나지 않는다.** 유료 larger runner(32코어+)라면 라벨을 만들어 실행 시 입력.
- 비공개 저장소의 호스티드 러너는 분 단위 과금(Windows 배율 2배)이다 — 6시간 실패를 반복하지 말 것.

## 3. 실행

### 3.1 수동 실행 (GitHub 웹 UI)
Actions 탭 → `swan-windows-build` → Run workflow → `runner` 에 JSON 라벨 입력. 완료되면 산출물 `swan-win-x64`(zip, 14일 보관)를 내려받아 `swan.exe` 실행.

### 3.2 외부 훅 실행 (API, 자동화 서버 등)
GitHub REST API 의 `repository_dispatch` 이벤트로 워크플로 트리거:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/tongjookim/Swan-Browser/dispatches \
  -d '{
    "event_type": "swan-windows-build-trigger",
    "client_payload": {
      "runner": ["self-hosted","windows","x64"],
      "jobs": "8",
      "target": "chrome"
    }
  }'
```

#### 필드 설명
- **event_type**: 반드시 `swan-windows-build-trigger` (고정)
- **client_payload.runner**: JSON 배열 형식. 러너 라벨 (예: `["self-hosted","windows","x64"]` 또는 `["windows-2022"]`)
- **client_payload.jobs**: autoninja 병렬도 (예: `"8"`). 비우면 자동.
- **client_payload.target**: ninja 빌드 타깃 (예: `"chrome"`). 기본값 `chrome`.

#### 예시 (Python)
```python
import requests
import os

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO = "tongjookim/Swan-Browser"

payload = {
    "event_type": "swan-windows-build-trigger",
    "client_payload": {
        "runner": ["self-hosted", "windows", "x64"],
        "jobs": "16",
        "target": "chrome"
    }
}

response = requests.post(
    f"https://api.github.com/repos/{REPO}/dispatches",
    json=payload,
    headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GITHUB_TOKEN}"
    }
)

if response.status_code == 204:
    print("✓ 빌드 워크플로 트리거됨")
else:
    print(f"✗ 실패: {response.status_code} - {response.text}")
```

#### 예시 (Node.js / GitHub Actions 내부)
```javascript
// .github/workflows/trigger-swan-build.yml 에서 실행
const octokit = require("@octokit/rest")({
  auth: process.env.GITHUB_TOKEN
});

octokit.rest.repos.createDispatchEvent({
  owner: "tongjookim",
  repo: "Swan-Browser",
  event_type: "swan-windows-build-trigger",
  client_payload: {
    runner: JSON.stringify(["self-hosted", "windows", "x64"]),
    jobs: "8",
    target: "chrome"
  }
});
```

## 4. 알려진 위험
- `lastchange`: 스냅샷 저장소라 upstream 정보가 없어 워크플로가 LASTCHANGE 를 직접 쓴다.
- 러너 PC 에 `.gclient` 가 이미 있으면 덮어쓰지 않음(작업 폴더 기준).
- `swan.exe` 이름 변경 그룹은 링크·실행 미검증 — 산출물 단계에서 없으면 실패하도록 해 두었다.
- `.github/workflows/close-pull-request.yml`(upstream)은 그대로 두었다(PR 자동 종료). 필요 없으면 삭제.

## 5. GitHub Token 발급

훅 실행에 필요한 PAT (Personal Access Token) 발급:
1. GitHub 설정 → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token → 이름: `SWAN_BUILD_DISPATCH` (예시)
3. Scopes: `repo` (또는 `public_repo` + `workflow`)
4. 생성된 토큰을 안전하게 보관 (재표시 불가)
5. 외부 서버에서 `GITHUB_TOKEN` 환경변수로 설정

또는 GitHub App 을 사용해 더 세밀한 권한 제어 가능.
