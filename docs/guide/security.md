# セキュリティポリシー

Open Shortlink の API（`/api/*`）と MCP（`/mcp`）は、**認証を掛けないと
世界中の誰からでも到達可能** な Cloudflare Workers のパブリックな URL で公開
されます。本プロジェクトでは運用者全員が以下のポリシーを守ることを前提として
設計されています。

## 方針宣言（Security Posture）

| 層 | 方式 | 位置付け | 必須 |
|---|---|---|---|
| **第一線** | **OAuth 2.1（PKCE + 動的クライアント登録）** — ユーザー認証は外部 IdP（Cloudflare Access もしくは任意の OpenID Connect プロバイダ）に委任 | **既定・必須** | ◎ |
| 二線目 | Cloudflare WAF / Rate Limiting Rules | 推奨 | △（任意） |
| 三線目 | Worker 組込みのレートリミット・セキュリティヘッダ・ホスト分割 | 既定で有効 | — |

原則:

1. **認証されていない API/MCP アクセスは一切許容しない**。`/api/*` と
   `/mcp` は OAuth 2.1 で保護され、有効なアクセストークン無しのリクエストは
   OAuthProvider が **401** で拒否する
2. **IdP が未設定または不完全な場合、`/authorize` は 503 を返し、
   サインインは成立しない**（fail-closed）。誰でも認可が通る状態には
   **決して** ならない
3. **リダイレクト (`GET /:slug`) のみ認証なしで公開**。これは短縮リンクの
   本来の機能であり、保存されている転送先 URL 以上の情報は返さない
4. 運用者は **Cloudflare Access か汎用 OIDC のどちらか一方** を必ず設定する。
   両方設定すると `/authorize` は 503 になる（排他）
5. 上流 IdP から返る email / sub は **allowlist とのマッチを強制**。
   allowlist が空なら `/authorize` は 503

## 第一線: OAuth 2.1 + 外部 IdP（必須）

`/api/*` と `/mcp` は、`@cloudflare/workers-oauth-provider` がアクセストークンを
検証してから下流ハンドラに到達します。アクセストークンは
`/authorize` → 外部 IdP サインイン → `/oauth/callback`（OIDC の場合）
→ `/token` の OAuth 2.1 フローで発行されます。**ユーザー本人性は
この Worker では扱わず、外部 IdP に委任します。**

### モード A: Cloudflare Access

Worker を [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/)
アプリケーションの背後に置き、Access が付与する署名済み JWT
（`Cf-Access-Jwt-Assertion` ヘッダー）を検証します。SSO は Access に任せられるため、
追加の OAuth アプリ登録は不要です。

設定変数:

| 変数 | 役割 |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access アプリの AUD タグ |
| `ACCESS_ALLOWED_EMAILS` | サインイン許可 email のカンマ区切り（必須） |

構成イメージ:

```
[ 短縮リンクユーザー ]                [ 運用者・MCP クライアント ]
        │                                      │
        ▼                                      ▼
┌────────────────┐                   ┌────────────────────┐
│ go.example.com │                   │ api.example.com    │
│ （認証なし）    │                   │ （Access 保護）     │
│  GET /:slug    │                   │  /api/*, /mcp      │
└────────┬───────┘                   └─────────┬──────────┘
         │                                      │ Access SSO
         └───────────── Worker ────────────────┘
                        ＋ OAuth 2.1 access token
```

Access 適用時の注意:

- Access のポリシー対象に `/mcp` と `/api/*` は含め、OAuth エンドポイント
  （`/authorize`, `/token`, `/register`, `/oauth/callback`,
  `/.well-known/oauth-authorization-server`）は **Bypass** にする。ただし
  `/authorize` は Access JWT を必要とするため、Bypass 対象からは外して
  **Allow（SSO）** を掛ける必要があります。具体的には:
  - `/authorize` → **Allow**（Access が JWT を注入する）
  - その他 OAuth エンドポイント → **Bypass**（クライアントが OAuth プロトコルで使う）

### モード B: 汎用 OIDC プロバイダ

任意の OpenID Connect プロバイダ（Auth0 / Okta / Microsoft Entra ID /
Google Workspace / Keycloak / Authelia / Zitadel など）と連携できます。

Worker は OIDC **Relying Party** として動作します:

1. クライアント（Claude Desktop 等）が `/authorize` を叩く
2. Worker は `${OIDC_ISSUER}/.well-known/openid-configuration` から
   discovery 情報を取得し、PKCE + state + nonce を生成
3. ブラウザを **上流 IdP の authorization endpoint** にリダイレクト
4. ユーザーが上流でサインイン完了後、IdP は `/oauth/callback?code=...&state=...`
   に戻す
5. Worker が `code` を **上流 `/token` エンドポイント** に交換し、
   ID Token の署名・`iss`・`aud`・`exp`・`nonce` を JWKS で検証
6. `email` または `sub` が `OIDC_ALLOWED_SUBS` に含まれる場合のみ、
   下流の Claude Desktop 向け OAuth 認可を完了

設定変数:

| 変数 | 役割 |
|---|---|
| `OIDC_ISSUER` | 例: `https://accounts.google.com`、Auth0/Okta テナント URL |
| `OIDC_CLIENT_ID` | 上流で発行された client_id |
| `OIDC_CLIENT_SECRET` | Secret として保管。ソースにコミットしない |
| `OIDC_ALLOWED_SUBS` | email / sub の allowlist（必須・カンマ区切り） |
| `OIDC_SCOPES` | 既定 `openid email profile`。`offline_access` を足すなど |

**上流 IdP 側で必要な登録:**

- アプリケーションタイプ: **Confidential / Web**
- `redirect_uri`: `https://<your-worker>/oauth/callback`
- 付与するグラント: **Authorization Code + PKCE**

### IdP 設定の強制（fail-closed）

- **両モード同時設定は不可**。両方のシークレットが存在すると `/authorize`
  は 503
- **allowlist 必須**。`ACCESS_ALLOWED_EMAILS` / `OIDC_ALLOWED_SUBS` が
  空なら 503（「Google アカウントを持っている人なら誰でも」という事故を防ぐ）
- **上流 issuer の変更検知**。`/authorize` と `/oauth/callback` の間に
  `OIDC_ISSUER` が変わっていれば 400（途中書き換え防止）
- **state の使い捨て**。`OAUTH_KV` に 10 分 TTL で保存、コールバック時に削除

### Worker 側の強制（自動）

コード側で以下が自動適用されます。運用者が何かを設定しなくても守られます。

- `/api/*` と `/mcp` は OAuthProvider がアクセストークンを検証し、
  無効なら 401 を返す（定数時間比較）
- `/authorize` は IdP が未設定 / allowlist が空ならば 503
- JWT 検証は `jose` ライブラリを使用し、JWKS はプロバイダの公開エンドポイント
  から取得・キャッシュ（1h）
- PKCE は S256 固定。plain 禁止（OAuthProvider の既定動作）
- アクセストークン寿命: 1 時間 / リフレッシュトークン: 30 日

## 共通のセキュリティ挙動

### MCP の OAuth フロー

MCP クライアント（Claude Desktop, Claude Code 等）は以下の流れで認証します:

1. クライアントが `/mcp` に接続を試みる
2. `/.well-known/oauth-authorization-server` からメタデータを取得
3. `/register` で動的クライアント登録（初回のみ）
4. ブラウザで `/authorize` を開く → 設定された IdP のサインイン画面
5. ユーザーサインイン後、`/token` でアクセストークン（1h）とリフレッシュトークン（30d）を取得
6. 以降、アクセストークンで MCP リクエストを認証。期限切れ時は自動更新

詳細は [MCP サーバー](../mcp#oauth-エンドポイント) を参照。

### REST API の使用

REST API (`/api/*`) も OAuth アクセストークンで認証します。curl 等から
直接叩く場合は、Claude Desktop と同じ OAuth 認可で取得したアクセストークンを
使うか、IdP 側で発行した Service Account / Machine-to-Machine 用のアクセストークン
を OAuthProvider の `resolveExternalToken` に通すカスタム実装を追加してください
（デフォルトではサポートしていません）。

運用的には、curl 用途も「ブラウザで一度 Claude Desktop を経由して短期トークンを
取得し、それを使う」のが最も単純です。

## 追加レイヤ: WAF / Rate Limiting Rules（推奨）

Cloudflare のエッジで更に段階を追加します。詳細は
[デプロイガイド](./deploy.md#レート制限) を参照。

- **Rate Limiting Rules**: `/api/*`, `/mcp` を IP 単位で制限（グローバル）
- **WAF Custom Rules**: 既知の悪性 IP / ボットをブロック
- **Bot Management**: Enterprise 以上で自動化スクリプト対策

Worker 組込みのレートリミッターは isolate 単位のバースト防止です。全世界で
束ねたいなら Rate Limiting Rules を必ず併用してください。

## 「何もしないとどうなるか」

このプロジェクトは fail-closed です。IdP を設定しないまま
Deploy to Cloudflare ボタンでデプロイした場合:

- `/authorize` は **503 server misconfigured** を返し、サインインは不可
- `/api/*` と `/mcp` は **401 unauthorized** を返し、アクセストークンは
  そもそも発行されない

「誰でも見える状態で稼働している」という危険な状態には **ならない** ように
作られています。

ただし **リダイレクト (`GET /:slug`) は認証なしで公開** されます。これは
機能要件上そうでなければならないため、以下の点に注意してください:

- `POST /api/links` で登録する URL に機密情報をクエリパラメータとして
  埋め込まない（参照できるのは `GET /api/links/:slug`＝認証あり だが、
  `GET /:slug` のリダイレクト先 `Location` ヘッダーは誰でも見られる）
- 期限付きリンク（`expiresIn`）を使って公開範囲を時間で絞る

## チェックリスト

デプロイ後、以下を順に確認してください。

### IdP 設定

OIDC の場合:

- [ ] 上流 IdP で OAuth アプリを登録し、`redirect_uri` を
      `https://<your-worker>/oauth/callback` にした
- [ ] `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_ALLOWED_SUBS`
      を Worker Secret として設定した
- [ ] Cloudflare Access の変数（`CF_ACCESS_*`）は **設定していない**

Cloudflare Access の場合:

- [ ] Access アプリケーションが Worker の URL を保護するよう構成した
- [ ] `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` / `ACCESS_ALLOWED_EMAILS`
      を Worker Secret として設定した
- [ ] OIDC 関連変数（`OIDC_*`）は **設定していない**

### 動作確認

- [ ] `curl https://<your-worker>/.well-known/oauth-authorization-server` が
      OAuth メタデータ JSON を返す
- [ ] `curl https://<your-worker>/api/links` が **401** を返す
- [ ] `curl "https://<your-worker>/authorize?response_type=code&client_id=..."` が
      OIDC モードなら **302**（上流 IdP へリダイレクト）、Access モードなら
      JWT 次第で **302 / 401 / 403** を返す
- [ ] Claude Desktop / Claude Code から MCP 接続 → ブラウザで上流 IdP の
      サインイン画面が開く → サインイン後に Claude に戻る
- [ ] allowlist に含まれない email でサインインすると **403 not authorized**

### 推奨

- [ ] ホスト分割（`REDIRECT_HOST` / `API_HOST`）を適用し、
      `go.example.com/api/...` は到達不能にした
- [ ] Cloudflare Rate Limiting Rules を `/api/*` と `/mcp` に適用した

## 脆弱性報告

セキュリティ上の問題を見つけた場合は、公開 Issue ではなく
[GitHub Security Advisories](https://github.com/tied-inc/open-shortlink/security/advisories/new)
から非公開で報告してください。
