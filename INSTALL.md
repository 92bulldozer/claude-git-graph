# Git 그래프 패널 설치 안내

Claude 데스크톱 앱의 대화창 옆 패널에 Git 커밋 그래프, 커밋별 변경 파일, 파일별 좌우 비교 탭을 보여 주는 모드입니다.

- 저장소: https://github.com/92bulldozer/claude-git-graph
- 마켓플레이스 이름: `local-mods`
- 플러그인 이름: `git-graph`

## Claude Code 에게 시키는 경우

새 컴퓨터의 Claude Code 에 아래 문장을 그대로 붙여 넣습니다.

> https://github.com/92bulldozer/claude-git-graph/blob/main/INSTALL.md 를 읽고 "설치 절차" 대로 Git 그래프 플러그인을 사용자 범위로 설치해 줘.

## 설치 절차

1. Claude CLI 를 찾습니다. PATH 의 `claude` 가 2.1.309 보다 낮으면 그 버전은 쓰지 않습니다(옛 버전은 이 모드의 `hooks.json` 형식을 검증하지 못합니다).
   데스크톱 앱에 들어 있는 CLI 를 씁니다. 위치는 PC 마다 다릅니다.
   ```powershell
   Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Recurse -Filter claude.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
   ```
   못 찾으면 `%APPDATA%\Claude\claude-code` 아래도 찾아봅니다. 아래 명령의 `claude` 는 찾은 경로로 바꿉니다.

2. 마켓플레이스를 추가합니다.
   ```bash
   claude plugin marketplace add 92bulldozer/claude-git-graph
   ```

3. 플러그인을 사용자 범위로 설치합니다.
   ```bash
   claude plugin install git-graph@local-mods --scope user
   ```

4. 설치를 확인합니다. `git-graph@local-mods` 가 enabled 로 나오면 됩니다.
   ```bash
   claude plugin list
   ```

5. 데스크톱 앱에서 Git 저장소 폴더로 **새 세션**을 엽니다. 이미 열려 있던 세션에는 나오지 않습니다.
   패널이 안 뜨면 입력창에 `/git-graph` 를 입력합니다.

## 앱 화면에서 설치하는 경우

1. 입력창 옆 `+` → **Plugins** 를 누릅니다.
2. **Add marketplace** 에 `92bulldozer/claude-git-graph` 를 입력합니다.
3. **Add plugin** 에서 `git-graph` 를 추가합니다.
4. 새 세션을 엽니다.

## 업데이트

```bash
claude plugin marketplace update local-mods
claude plugin update git-graph@local-mods
```

## 제거

```bash
claude plugin uninstall git-graph@local-mods
claude plugin marketplace remove local-mods
```

## 참고

- Windows 데스크톱 앱에서 만들고 확인했습니다.
- 패널은 모든 세션에서 자동으로 뜹니다. Git 저장소가 아닌 폴더에서는 그래프 대신 안내 문구가 보입니다.
- 패널은 세션 폴더의 최근 커밋 60개를 30초마다 읽습니다. 커밋 내용은 컴퓨터 밖으로 나가지 않습니다.
- 색은 어두운 테마 기준입니다.
