# セキュリティポリシー

Open Shortlink の API（`/api/*`）と MCP（`/mcp`）は、**認証を掛けないと
世界中の誰からでも到達可能** な Cloudflare Workers のパブリックな URL で公開
されます。本プロジェクトでは運用者全員が以下のポリシーを守ることを前提として
設計されています。

## 方針宣言（Security Posture）

| 層 | 方式 | 位置付け | 必須 |
|---|---|---|---|
| **第一線** | Worker 内の `API_TOKEN` による Bearer 認証 | **既定・必須** | ◎ |
| **二線目** | Cloudflare Access（Zero Trust） | 推奨・defense-in-depth | △（任意） |
| 三線目 | Cloudflare WAF / Rate Limiting Rules | 推奨 | △（任意） |

原則:

1. **認証されていない API/MCP アクセスは一切許容しない**。Bearer トークンが
   欠落または弱い場合、Worker は `503 server misconfigured` を返し、リンク
   作成・一覧・削除・分析などの**書き込み・閲覧を一切実行しない**
   （fail-closed）
2. **リダイレクト (`GET /:slug`) のみ認証なしで公開**。これは短縮リンクの
   本来の機能であり、保存されている転送先 URL 以上の情報は返さない
3. 運用者は **必ず `API_TOKEN` を強いランダム値で設定** する。未設定・弱い
   値・既知プレースホルダ（`dev-token-change-me` など）は Worker が起動時に
   拒否する
4. 組織・チーム運用では Cloudflare Access を重ねて適用することを推奨。ただし
   **Access を単独で認証に据えない**（MCP クライアントが対話型認証に
   追随できないため）

## 第一線: Bearer トークン（必須）

### 要件

- **長さ**: 24 文字以上（`openssl rand -base64 32` の出力を推奨）
- **値**: ランダム。`dev-token-change-me` / `test-token` / `secret` などの
  既知プレースホルダは拒否される
- **取り扱い**: `wrangler secret put API_TOKEN` で Secret として設定。
  ソースコードや `wrangler.toml` の `[vars]` には絶対に書かない

### Worker 側の強制（自動）

`src/middleware/auth.ts` で以下が自動適用されます。運用者が何かを設定
しなくてもコード側で守られます。

- `API_TOKEN` が未設定または 24 文字未満、もしくは既知プレースホルダの
  場合 → `/api/*` と `/mcp*` は **503** を返し、`WWW-Authenticate:
  Bearer realm="open-shortlink"` を付与。**リクエスト本体の処理には
  進まない**
- リクエストの `Authorization: Bearer ...` が一致しない場合 → 401
- 比較は定数時間比較（タイミング攻撃耐性）

### トークンの生成と設定

```bash
# 生成例（どれでも可）
openssl rand -base64 32
uuidgen | tr -d '-' | head -c 40

# Cloudflare Secret として登録
wrangler secret put API_TOKEN
# プロンプトにトークンを貼り付け
```

Cloudflare ダッシュボード経由でも設定可能（Workers & Pages → Worker →
Settings → Variables → Add secret）。

### ローテーション

- 最低でも **1 年に 1 度**、またはチームメンバーが離れた時、トークン漏洩が
  疑われた時に必ずローテーション
- `wrangler secret put API_TOKEN` で上書き → 既存クライアント（MCP 設定、
  Custom GPT 等）の Bearer ヘッダーを同時に差し替え
- KV のデータは破棄されないため、ローテーション中に短縮リンク自体は停止
  しない

## 二線目: Cloudflare Access（推奨）

`API_TOKEN` はあくまで **共有シークレット** であり、漏洩すると全権限を
奪われます。次のいずれかに該当する場合、Cloudflare Access で
`API_HOST`（例: `api.example.com`）を保護することを強く推奨します。

- 複数人で運用しており、個人単位でアクセス権を付け外ししたい
- 会社・チームの SSO（Google / Okta / Microsoft Entra ID など）と紐付けたい
- 送信元 IP / デバイス姿勢で絞りたい
- SOC2 / ISO27001 などの認証要件に合わせたい

### 構成（推奨例）

```
[ 短縮リンクユーザー ]                [ 運用者・MCP クライアント ]
        │                                      │
        ▼                                      ▼
┌────────────────┐                   ┌────────────────────┐
│ go.example.com │                   │ api.example.com    │
│ （認証なし）    │                   │ （Access 保護）     │
│  GET /:slug    │                   │  /api/*, /mcp      │
└────────┬───────┘                   └─────────┬──────────┘
         │                                      │ SSO or Service Token
         └───────────── Worker ────────────────┘
                       ＋ Bearer API_TOKEN
```

短縮リンクのホスト（`REDIRECT_HOST`）は誰でもアクセスできる必要があるため
Access を **掛けない**。API/MCP のホスト（`API_HOST`）にだけ掛けます。
`src/index.ts` のホスト分割機能（`REDIRECT_HOST` / `API_HOST`）を併用する
ことで、この分離を Worker 側でも強制できます。

### MCP クライアント向け: Service Token 必須

Claude Desktop / Claude Code / ChatGPT / Cursor 等の MCP クライアントは
Access の対話型 SSO に追随できません。MCP を使う運用者は **Access Service
Token** を発行し、固定ヘッダーを付けて接続します。

1. Cloudflare Zero Trust ダッシュボード → Access → **Service Auth → Service Tokens**
2. "Create Service Token" → Client ID / Client Secret を控える（一度だけ表示）
3. 対象 Access Application のポリシーに **Include → Service Token** を追加
4. MCP クライアント設定にヘッダーを 3 つ並べる:

```json
{
  "mcpServers": {
    "shortlink": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <API_TOKEN>",
        "CF-Access-Client-Id": "<client-id>.access",
        "CF-Access-Client-Secret": "<client-secret>"
      }
    }
  }
}
```

人間が個別に使う REST API は、ブラウザ経由の SSO で問題ありません。

### Access 設定の要点

- **Application Type**: Self-hosted
- **Application domain**: `api.example.com`（`go.example.com` は含めない）
- **Session Duration**: 24h 程度が無難
- **Policies**:
  - `Allow` 会社の SSO グループ（人間用）
  - `Allow` Service Token（MCP / CI 用）
  - 必要なら `Require` に MFA / 企業デバイスを追加

## 三線目: WAF / Rate Limiting Rules（推奨）

Cloudflare のエッジで更に段階を追加します。詳細は
[デプロイガイド](./deploy.md#レート制限) を参照。

- **Rate Limiting Rules**: `/api/*`, `/mcp` を IP 単位で制限（グローバル）
- **WAF Custom Rules**: 既知の悪性 IP / ボットをブロック
- **Bot Management**: Enterprise 以上で自動化スクリプト対策

Worker 組込みのレートリミッターは isolate 単位のバースト防止です。全世界で
束ねたいなら Rate Limiting Rules を必ず併用してください。

## 「何もしないとどうなるか」

このプロジェクトは fail-closed です。`API_TOKEN` を設定しないまま
Deploy to Cloudflare ボタンでデプロイした場合、API/MCP 経路は **503 の
連発になるだけで、リンク作成・削除・閲覧は一切できません**。「誰でも見える
状態で稼働している」という危険な状態には **ならない** ように作られて
います。

ただし **リダイレクト (`GET /:slug`) は認証なしで公開** されます。これは
機能要件上そうでなければならないため、以下の点に注意してください:

- `POST /api/links` で登録する URL に機密情報をクエリパラメータとして
  埋め込まない（参照できるのは `GET /api/links/:slug`＝認証あり だが、
  `GET /:slug` のリダイレクト先 `Location` ヘッダーは誰でも見られる）
- 期限付きリンク（`expiresIn`）を使って公開範囲を時間で絞る

## チェックリスト

デプロイ後、以下を順に確認してください。

- [ ] `API_TOKEN` を 24 文字以上のランダム値で設定した
- [ ] `curl https://<your-worker>/api/links` が **401** を返す（403/200 なら未設定）
- [ ] `curl -H "Authorization: Bearer <token>" https://<your-worker>/api/links` が **200** を返す
- [ ] `curl https://<your-worker>/api/links` が **503** を返さない（503 なら `API_TOKEN` が弱い）
- [ ] トークンを 1Password / Bitwarden / Cloudflare Secret 以外に保存していない
- [ ] （推奨）`API_HOST` を別サブドメインにして Cloudflare Access を適用した
- [ ] （推奨）Cloudflare Rate Limiting Rules を `/api/*` と `/mcp` に適用した

## 脆弱性報告

セキュリティ上の問題を見つけた場合は、公開 Issue ではなく
[GitHub Security Advisories](https://github.com/tied-inc/open-shortlink/security/advisories/new)
から非公開で報告してください。
