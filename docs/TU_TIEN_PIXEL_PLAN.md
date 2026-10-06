# Tu Tiên Pixel — kế hoạch dựng

Mockup duyệt ở canvas: https://claude.ai/artifact/TqVLxNw7dfCHcwKj96Zsg8 (9 trang: Base UI,
Hồ sơ, Chiến đấu, Đột phá, Thiên kiếp, Đồ đạc, Hằng ngày, Bí cảnh, Tạo hình). Mọi ảnh bot gửi
phải khớp mockup: cùng màu, cùng font VT323, icon chỉ ở tỉ lệ nguyên, chân nhân vật đặt trên
đường đất.

Quy ước chung:
- Bot vẽ bằng node-canvas. Ảnh tĩnh xuất PNG; ảnh có chuyển động xuất GIF lặp (8–16 khung, ≤ 3 MB).
- Logic game không đổi trừ khi task ghi rõ. Không bán vật phẩm, đan dược, cống hiến bằng tiền thật
  (Nghị định 147/2024).
- Mỗi task xong: `npm run typecheck`, `npx biome check`, test liên quan (`vitest --pool=forks`),
  tick ô ở đây và ghi commit hash.

Ký hiệu: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong · ⛔ chờ Bill quyết.

---

## Quyết định còn mở (cần Bill trả lời trước phase liên quan)

- [ ] ⛔ License 4 pack quái (Knight, Paladin, Canines, Dark Fantasy Bat): link trang tải để kiểm tra. Chặn P0.6 ở bản deploy, không chặn code.
- [ ] ⛔ File gốc bộ 32 quái chibi và sheet pháp sư trượng đỏ (chỉ có ảnh xem trước).
- [ ] ⛔ Dịch vụ chạy code cho Thiên Kiếp Đài: đề xuất JDoodle (200 lượt/ngày miễn phí) + Piston public dự phòng. Cần tài khoản JDoodle (Bill tự tạo, tự dán key vào .env).
- [ ] ⛔ Phần thưởng 4 bậc thiên kiếp (đề xuất: 500/900/1,800/4,000 XP; 5/8/15/30 đan).
- [ ] ⛔ Tên miền cho web (đề xuất giữ `hunter.billthedev.com` hoặc thêm `tutien.billthedev.com`).
- [ ] Mặc định nếu Bill không nói gì: giữ nút Ngẫu nhiên trong Discord; đồ đeo lưng do người chơi chọn; món khóa theo cảnh giới như mockup.

---

## P0 — Bộ vẽ pixel dùng chung (`src/modules/pixel/`)

Nền cho mọi phase sau. Mỗi hàm vẽ được test bằng ảnh chụp so khớp kích thước và vài điểm ảnh.

- [x] P0.1 Font: VT323 vẽ từ atlas bitmap dựng sẵn (`scripts/build-font-atlas.py`) vì node-canvas không nạp được font trên Windows; bỏ Noto Serif. `text()` có chế độ đậm bằng cách vẽ lệch 1–2 px. (`bbd5122`)
- [x] P0.2 Token màu và thành phần: panel, chip, nút giả, thanh tiến độ phân đoạn, ô chỉ số, dòng tiền tệ (đan dược, cống hiến), nhãn chữ hoa. Khớp trang Base UI.
- [x] P0.3 Icon: vẽ icon chỉ ở 32/64/128 px (assert tỉ lệ nguyên), `imageSmoothingEnabled = false`.
- [x] P0.4 Bảng ánh xạ catalog → icon wuxia: vũ khí theo từ khóa tên (Kiếm, Đao, Đại Đao, Thương, Côn, Chuỳ, Phiến…) rồi theo `category`; phẩm (`pham…than, ban_menh`) → chất liệu; pháp khí, nhẫn theo `type`/`rarity`; công pháp → cuộn trục theo rarity. Test: mọi slug trong 4 catalog đều có icon.
- [x] P0.5 Ghép nhân vật từ sprite sheet (da, mắt, tóc, áo, giày, đồ đeo), lật trái phải, hình bóng xám khi chưa tạo hình. Cache theo bộ số + scale.
- [x] P0.6 Sprite quái từ pack: nạp strip, cắt khung, vẽ theo khung (sói 4 màu, dơi, kiếm vệ, hộ pháp) và 5 quái tự vẽ (dạng lưới điểm ảnh).
- [x] P0.7 Thư viện hiệu ứng trên canvas, theo đúng tên ở Base UI: lấp lánh, hạt bay, vòng hào quang, tia xoay, cột sáng, sét có nhánh + mây + chớp màn hình, vệt chém, số sát thương, lửa, mảnh vỡ, rung, thở. Mỗi hiệu ứng nhận `t` (0–1) để vẽ theo khung.
- [x] P0.8 Dấu ấn cường hóa 4 bậc (+1~3, +4~6, +7~9, +10) vẽ đè lên icon; bỏ vòng hào quang khi ô < 70 px.
- [x] P0.9 Hào quang 11 cảnh giới (`realmFx(i, t)`), mỗi bậc chồng thêm lớp như trang Đột phá.
- [x] P0.10 Bộ dựng GIF: nhận hàm `draw(ctx, t)`, xuất N khung, palette chung, giới hạn dung lượng, tự lùi về PNG khung đẹp nhất nếu quá cỡ. Thêm dependency encoder GIF (thuần JS).
- [x] P0.11 Script `npm run render:preview` xuất mọi màn ra `tmp/preview/` để soát bằng mắt; test chụp ảnh cho từng màn.

## P1 — Tạo hình tu sĩ (đã làm dở: store, catalog, link)

- [x] P1.1 Kiểu `Avatar` và collection `avatars` (WAL + snapshot).
- [x] P1.2 `avatar/catalog.ts`: 7 nhóm lựa chọn, khóa theo cảnh giới, kiểm tra, ngẫu nhiên, mô tả.
- [x] P1.3 `avatar/link.ts`: link ký HMAC, 15 phút, link mới thay link cũ, 10 lần lưu/phút.
- [x] P1.4 Test cho catalog, link, lưu/đọc store.
- [x] P1.5 API web: `GET /avatar` (trang), `GET /avatar/assets/*` (whitelist), `GET /avatar/api/state`, `POST /avatar/api/save`. Trang tạo hình theo mockup, chạy cả trên điện thoại.
- [x] P1.6 Lệnh `/profile avatar`: tin nhắn ẩn có ảnh hiện tại, nút mở link, nút Ngẫu nhiên. Lưu trên web thì sửa luôn tin nhắn ẩn (webhook của interaction).
- [x] P1.7 Trang hết hạn, trang lỗi, chặn món chưa mở ở server.

## P2 — Ảnh cho các lệnh đang có

Thay embed chữ bằng ảnh, giữ phần chữ quan trọng trong embed để đọc được khi ảnh chưa tải.

- [ ] P2.1 `/profile me` thẻ tu sĩ (PNG) + giữ "Gợi ý kế" dạng chữ.
- [ ] P2.2 `/profile rank` bậc thang 11 cảnh giới.
- [ ] P2.3 `/profile stat` lực chiến 9 nguồn + công pháp.
- [ ] P2.4 `/profile alloc` ảnh vẽ lại sau mỗi lần bấm +1, ô vừa cộng sáng lên.
- [ ] P2.5 `/title danh-hieu` và `/title phong-hieu`.
- [x] P2.6 `/gear inventory` túi đồ 5 tab; `/gear … info` thẻ chi tiết vũ khí, công pháp, pháp khí, nhẫn.
- [x] P2.7 `/gear … upgrade` kết quả cường hóa (GIF: thành công, thất bại, thất bại nặng).
- [x] P2.8 `/shop browse` đan tiệm 4 tab với 5 trạng thái; `/shop trade sell` (GIF khi Aki hào phóng).
- [x] P2.9 `/admin arena forge` rèn bản mệnh (GIF).
- [x] P2.10 `/daily` lịch 30 ngày; `/quest` bảng nhiệm vụ.
- [x] P2.11 `/duel`: lời thách đấu (PNG), kết quả (GIF 5 hiệp), miểu sát (GIF).
- [x] P2.12 `/leaderboard` bục top 3 + danh sách; bảng tuần tự đăng dùng cùng ảnh.
- [x] P2.13 `/breakthrough` Lôi Kiếp (GIF ra đề, qua, trượt).
- [ ] P2.14 Thông báo lên cảnh giới tự đăng (GIF theo 11 bậc), thay `aura.ts` dạng emoji.
- [ ] P2.15 `/mod thien-dao` Thiên Đạo phán quyết (GIF).
- [x] P2.16 Sửa lệch có sẵn: chân bảng xếp hạng ghi "level×10" nhưng `/profile stat` tính ×5; `/quest` in slug thô cho 6 loại nhiệm vụ; `trade` chỉ gỡ trang bị ở trường cũ, bỏ sót mảng nhiều ô. (Đã sửa cả ba: trade cùng P2.8, chân bảng và nhãn nhiệm vụ cùng P2.10.)

## P3 — Phong Kiếp (thiên kiếp bậc 2, trong Discord)

- [ ] P3.1 Định tuyến kiếp theo cảnh giới: Trúc Cơ–Kim Đan → Lôi Kiếp; Nguyên Anh–Hóa Thần → Phong Kiếp; Luyện Hư trở lên → Tâm Ma / Cửu Thiên (P4).
- [ ] P3.2 Ngân hàng câu hỏi (JSON có kiểm tra zod): tiếng Anh cho dev (đọc lỗi, chọn nghĩa) và đoán output C#/Python, mỗi câu gắn bài docs liên quan trên billthedev.com/docs.
- [ ] P3.3 Luồng 3 câu, 45 giây mỗi câu, đúng 2/3 là qua; ảnh câu hỏi + nút A–D; mở link bài docs sau khi trả lời.
- [ ] P3.4 Phần thưởng theo bậc (chờ ⛔ số liệu), test luồng qua và trượt.

## P4 — Thiên Kiếp Đài (giải thuật toán trên web)

- [ ] P4.1 Ngân hàng đề lấy từ 23 bài Interview Algorithms, kể lại theo chất tu tiên; mỗi đề có ví dụ, 15+ test ẩn, giới hạn thời gian, link bài nền tảng và link lời giải (khóa tới khi xong kiếp).
- [ ] P4.2 Bộ chấm: gói code người chơi + toàn bộ test ẩn thành MỘT lần chạy (harness C#, Python, JS), so kết quả trên server bot; gọi JDoodle, lỗi thì thử Piston public; đếm hạn mức ngày.
- [ ] P4.3 Trang web theo mockup: đề, Tàng Kinh Các, ô soạn code (CodeMirror 6), Chạy thử trong trình duyệt (Pyodide cho Python, Worker cho JS; C# đi qua API), Nộp bài, đồng hồ, số lần nộp.
- [ ] P4.4 Link riêng có ký (dùng chung cơ chế P1.3), mở trang là bắt đầu tính giờ, hết giờ tự nộp.
- [ ] P4.5 Kết quả gửi về Discord (GIF qua / trượt), cộng thưởng, mở bài giải; nhật ký nộp bài để chống gian lận.
- [ ] P4.6 Cửu Thiên Lôi Kiếp: 2 bài quy hoạch động / đồ thị, test lớn để ép đúng độ phức tạp.

## P5 — Nhiệm vụ hằng ngày mới

- [ ] P5.1 Nhóm Học tập: giải 1 bài ở Tàng Kinh Các (dùng bộ chấm P4, đề dễ, không tính kiếp); đọc 1 bài docs + trả lời 3 câu.
- [ ] P5.2 Nhóm Trảm yêu: hạ N quái ở bí cảnh (nối P6).
- [ ] P5.3 Boss tuần dùng chung máu cho cả tông môn.
- [ ] P5.4 Tên tiếng Việt cho mọi loại nhiệm vụ; nút "Vào web" cho nhiệm vụ cần web.

## P6 — Bí cảnh treo máy (web)

- [ ] P6.1 Mô phỏng tất định phía server: sóng quái, đội tối đa 3, chỉ số lấy từ lực chiến, kỹ năng hồi chiêu; treo tối đa 8 giờ tính lúc quay lại (không cần chạy liên tục).
- [ ] P6.2 Bảng rơi đồ và giới hạn thu nhập mỗi ngày để không phá kinh tế đan dược.
- [ ] P6.3 Trang web vẽ bằng canvas trình duyệt, dùng chung sprite và hiệu ứng (bản JS của P0), có nút Rút lui, Lên tầng.
- [ ] P6.4 Báo cáo raid gửi về Discord khi người chơi quay lại; góp máu boss tuần.
- [ ] P6.5 Yêu thú lục: lệnh xem quái theo bãi và đồ rơi.

## P7 — Cân bằng và chống lạm dụng

- [ ] P7.1 Bảng kinh tế: nguồn vào / nguồn ra của XP, đan dược, cống hiến trước và sau khi thêm raid + kiếp mới.
- [ ] P7.2 Giới hạn tần suất các API web, log đáng ngờ vào `#bot-log`.
- [ ] P7.3 Test hồi quy cho công thức lực chiến và phần thưởng.

## P8 — Hạ tầng và deploy

- [ ] P8.1 nginx: mở thêm `/avatar/`, `/judge/`, `/raid/` (hiện chỉ mở `/oauth/`).
- [ ] P8.2 `.env`: khóa ký link, JDoodle client id/secret (Bill tự điền), giới hạn hạn mức.
- [ ] P8.3 Kiểm tra RAM/CPU VPS khi vẽ GIF; hàng đợi vẽ ảnh nếu nhiều người gọi cùng lúc.
- [ ] P8.4 Deploy theo từng phase, có bản backup trước mỗi lần như `DEPLOY.md`.
- [ ] P8.5 Ghi nguồn asset: Pixel People (CC0), wuxia icons (CC0), VT323 (OFL), các pack quái (theo license ⛔).

## P9 — Kiếm tiền (làm sau khi có người chơi thật)

Không bán đồ trong game. Chỉ quyền lợi ngoài game và dịch vụ học.

- [ ] P9.1 Ủng hộ server (Ko-fi / QR): role, màu tên, kênh voice riêng.
- [ ] P9.2 Gói luyện phỏng vấn: đề khó, lời giải video, buổi chữa bài 1-1.
- [ ] P9.3 Chỗ tài trợ: "thiên kiếp tuần" hoặc bí cảnh mang tên nhà tài trợ, kênh tuyển dụng.
- [ ] P9.4 Hỏi luật sư trước khi thu tiền thật.

---

## Thứ tự chạy đề xuất

P0 → P1 → P2 (theo thứ tự P2.1 → P2.15) → P3 → P5.4/P2.16 → P4 → P5 → P6 → P7 → P8 (deploy từng
đợt sau P1, P2, P4, P6) → P9.
