# Personal AI — Hermes Hybrid Blueprint

> **Status:** Prep / scoping (chưa code). Anchor doc cho sáng kiến "personal AI làm ra tiền".
> Viết 2026-06-02 sau session scoping với Bill. Đây là tài liệu neo — code chưa bắt đầu.

---

## 1. Vision

Một **personal AI luôn-bật** giúp Bill ra quyết định tài chính (và sau này làm content) tốt hơn —
không phải bot tự trade tiền thật (đó là rủi ro/hype, để phase rất sau). Lõi giá trị = **research + alpha + đề xuất**,
con người vẫn là người bấm nút.

Kiến trúc **hybrid**: tận dụng **Hermes Agent** (Nous Research) làm não always-on trên VPS,
giữ **radiant-bot** (Discord) nguyên vai cộng đồng, nối 2 hệ qua control API. **Telegram** = phòng điều khiển
riêng của Bill; **Discord** = nơi Aki phát báo cáo.

---

## 2. Quyết định đã chốt (2026-06-02)

| Hạng mục | Chốt |
|---|---|
| Hướng tổng | **Hybrid (C)** — Hermes trên VPS + radiant-bot Discord, nối qua REST/HMAC |
| Research engine / não | **Hermes Agent** điều phối, cắm **Claude** cho việc khó + model rẻ (Nous/Groq/Gemini/OpenRouter) cho việc thường |
| Code home (phần bot) | **Module trong radiant-bot** cho seam control API; Hermes là hệ riêng trên VPS |
| Kênh điều khiển của Bill | **Telegram personal** — full service: chat + ra lệnh + thao tác |
| Kênh output | **Discord** — Aki phát báo cáo thị trường + đề xuất đầu tư |
| Báo cáo gated cho | **Role Trưởng Lão + Tiên Nhân** (kênh riêng), giai đoạn đầu — chưa public |
| Brain-viz | **Web dashboard** (React + three.js/canvas), telemetry qua WebSocket |
| Skills | Chuẩn mở **agentskills.io** (`SKILL.md`) — chạy chung Claude Code + Hermes |

### Insight chiến lược
**Skills là tài sản lâu dài, runtime thì thay được.** Viết logic kiếm-tiền dạng Agent Skill (chuẩn mở)
→ chạy được cả Claude Code (Bill xài tay) lẫn Hermes (agent always-on). Đừng over-index vào runtime.

---

## 3. Chưa chốt (to-decide)

- **Schedule research** — "khoan hãy tính đã". (Gợi ý: 2 lần/ngày, vd 07:00 + 19:00 VN.)
- **Watchlist coin cụ thể** — BTC/ETH + những đồng nào.
- **Loại vàng** — XAU/USD (thế giới) và/hoặc SJC (VN).
- **Model provider chính cho Hermes** — Anthropic trực tiếp (đắt, chất) vs OpenRouter (rẻ, linh hoạt) vs Nous Portal.
- **"Simulate AI để train bảng skill" (arena)** — Bill nhắc 1 lần rồi pivot sang Hermes; chưa làm rõ. Có thể là track research riêng cho arena skill balance, hoặc tách hẳn. Để mở.
- **Zalo bridge** — Hermes KHÔNG hỗ trợ Zalo sẵn (chỉ Telegram/Discord/Slack/WhatsApp/Signal/email). Nếu cần "nhắn ngược qua Zalo" như setup của manager → custom (Zalo OA API hoặc n8n Zalo node). Để phase sau.

---

## 4. Topology

```
   📱 Telegram (riêng Bill) ──► FULL SERVICE: chat + ra lệnh + thao tác máy
        │  ▲
        ▼  │  (Bill ra lệnh, Hermes báo lại)
   ┌──────────────┐   Não: Claude (việc khó) + Nous/Groq/Gemini (việc rẻ)
   │    HERMES    │   Skills: coin · vàng · macro · alpha · content · last30days · finance
   │ (VPS Ubuntu) │   Memory + cron 2 lần/ngày
   └──────┬───────┘
          │  REST + HMAC  (control API — seam tích hợp)
          ▼
   ┌──────────────┐   ► Discord: Aki POST báo cáo thị trường + đề xuất đầu tư
   │ radiant-bot  │     (kênh gated: Trưởng Lão + Tiên Nhân)
   │  (Discord)   │   ◄ Hermes RA LỆNH cho Aki làm gì trong Discord
   └──────────────┘
```

---

## 5. Components

### 5.1 Hermes Agent (VPS Ubuntu)
- Open-source, MIT. Self-improving, persistent memory, tự tạo skill, subagent song song.
- Model-agnostic (Anthropic/OpenRouter/Nous/OpenAI/...). 40+ tool sẵn (web search, file, terminal exec).
- Backend: local/Docker/SSH/Singularity/**Modal/Daytona** (serverless, idle gần free).
- Gateway 1 điểm → Telegram (line riêng của Bill).
- Install: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash` → `hermes` / `hermes gateway`.
- Yêu cầu: Python 3.11+, Node, ripgrep, ffmpeg + API key model + Telegram bot token.

### 5.2 radiant-bot control API (seam tích hợp) — phần CODE thật trong repo này
- Mở rộng REST sẵn có (`POST /api/contribute` + HMAC) thành `POST /api/agent/*`.
- Tái dùng CLI dispatcher (`src/cli/dispatcher.ts` + services: send/notify...).
- Luồng: **Telegram → Hermes hiểu lệnh → gọi control API (HMAC) → radiant-bot thực thi dưới danh nghĩa Aki.**
- Báo cáo hằng ngày cũng đi đường này → Aki phát (một giọng duy nhất, không thêm bot lạ trong server).
- **An ninh:** khóa cứng Telegram user ID của Bill + HMAC; whitelist hành động Aki được phép.

### 5.3 Skills (tài sản lâu dài, chuẩn agentskills.io)
Tracks research mỗi ngày → gộp `research/YYYY-MM-DD.md` + cập nhật `TREND.md`:
1. Crypto core (BTC + market, biến động 24h)
2. New coins / narratives / hướng đầu tư
3. Alpha / kiếm tiền (airdrop, launch, cơ hội)
4. Gold (giá + xu hướng)
5. Macro (Fed, CPI, lãi suất — giải thích biến động)
6. Content & data trends (cho hướng content của Bill)

Skill cộng đồng tham khảo (đã vet sơ, hợp Claude Code):
- `awesome-finance-skills` — 8 skill: tin 10+ nguồn, giá CK CN/HK/US, sentiment FinBERT, dự báo Kronos, signal tracker, report.
- `last30days-skill` — research across Reddit/X/YouTube/TikTok/HN/Polymarket/GitHub → tóm tắt có dẫn chứng.
- `MiroFish` — engine mô phỏng bầy đàn dự đoán (app riêng, Python+Vue, nặng) — optional về sau.

⚠️ Vet kỹ trước khi tin output cho quyết định tiền.

### 5.4 Web brain-viz dashboard
- Cục năng lượng giữa + dây nối tới từng LLM, dòng năng lượng chạy khi LLM đó active.
- **Phần dễ:** đồ họa (three.js/canvas particle-flow).
- **Phần khó = việc thật:** **telemetry** — Hermes + LLM router của bot phải bắn event live ("đang gọi LLM X, token, latency") qua WebSocket/SSE → viz mới "có năng lượng thật" thay vì đèn nháy giả.
- **Wow-factor / về sau** — làm SAU khi pipeline kiếm-tiền chạy được.

---

## 6. Kỷ luật an toàn & chi phí

1. **Thao tác máy + auto-trade = rủi ro tiền thật.** Giai đoạn đầu read-only/cố vấn. Không đụng tiền thật tới khi tin pipeline.
2. **Cost:** agent 24/7 với Anthropic đốt tiền thật → model rẻ cho việc thường, Claude cho việc khó. Modal/Daytona idle gần free. Cân nhắc daily budget cap (như Aki `/ask`).
3. **Secrets** (xem memory `feedback-secrets-paste`): API key model + Telegram token + (sau) API sàn → đặt trên VPS, **KHÔNG paste vào chat**. Key sàn phải **read-only / không rút tiền**.

---

## 7. Action items cho Bill (prerequisites — Bill tự làm, đừng paste secret)

- [ ] Xác nhận VPS Ubuntu dùng cho Hermes (cùng Vietnix `14.225.255.73` hay box riêng?).
- [ ] Tạo Telegram bot token (BotFather) — giữ trong env trên VPS, không paste.
- [ ] Chọn model provider chính cho Hermes (Anthropic / OpenRouter / Nous Portal).
- [ ] Chốt watchlist coin + loại vàng + giờ chạy 2 lần/ngày.

---

## 8. Phasing đề xuất (sequence)

1. **P1 — Hermes dựng + chat Telegram:** cài Hermes trên VPS, cắm model, nối Telegram, chat được qua lại. (Đây là "kênh giao tiếp AI" cốt lõi.)
2. **P2 — Research skills + cron:** 6 tracks → file daily + TREND.md. Test output chất lượng.
3. **P3 — Control API seam (radiant-bot):** `/api/agent/*` + HMAC → Hermes đẩy báo cáo cho Aki phát vào kênh gated (Trưởng Lão + Tiên Nhân). Remote-control Aki từ Telegram.
4. **P4 — Web brain-viz:** telemetry trước, viz sau.
5. **P5+ (về sau, cần bàn riêng):** auto-trade (read-only → live), Zalo bridge, arena skill-sim, MiroFish.

---

## 9. References

- Hermes Agent — https://github.com/NousResearch/hermes-agent · https://hermes-agent.nousresearch.com/
- Agent Skills standard — https://agentskills.io
- awesome-finance-skills — https://github.com/rkiding/awesome-finance-skills
- last30days-skill — https://github.com/mvanhorn/last30days-skill
- MiroFish — https://github.com/666ghj/MiroFish
- radiant-bot seam: `src/cli/dispatcher.ts`, REST `POST /api/contribute` (HMAC), `src/modules/scheduler/index.ts`, `src/modules/llm/`
