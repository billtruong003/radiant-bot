# Kinh tế Tu Tiên Pixel (P7.1)

Số liệu tính thẳng từ hằng số trong code (`src/modules/balance/economy.ts`).
`tests/balance/economy.test.ts` chặn mọi thay đổi vượt giới hạn bên dưới; muốn nới thì sửa file này kèm lý do trước.

## Thu nhập một ngày của người chơi chăm (không tính XP tin nhắn, không tính thiên kiếp)

| Nguồn | Trước Tu Tiên Pixel (XP / đan / cống hiến) | Sau |
|---|---|---|
| `/daily` (chưa tính mốc streak) | 100 / 2 / 5 | 100 / 2 / 5 |
| Nhiệm vụ hằng ngày (trung bình pool) | 66 / 1,7 / 24 | 66 / 1,7 / 24 |
| Nhiệm vụ học tập (trung bình) | — | 100 / 1,5 / 20 |
| Nhiệm vụ trảm yêu (trung bình) | — | 100 / 1,5 / 20 |
| Bí cảnh (giới hạn ngày) | — | 400 / 2 / 40 |
| Boss tuần (chia 7 ngày) | — | 43 / 0,7 / 14 |
| **Tổng** | **166 / 3,7 / 29** | **809 / 9,4 / 123** |

Đan dược tăng ×2,5, cống hiến ×4,3. XP tăng mạnh nhất vì bí cảnh, nhưng XP chỉ đẩy cấp, không mua được gì.

## Nguồn ra (sink)

- Cường hóa vũ khí +0 → +7, tính cả lần trượt: khoảng **191 đan** và **13 664 cống hiến**.
  Với thu nhập mới: ~20 ngày đan, ~111 ngày cống hiến. Cống hiến vẫn là nút thắt, như trước.
- Thiên kiếp: 1 đan mỗi lần (thắng thì lãi).
- Shop: vũ khí 300–4 000 cống hiến, tới 100 đan.
- Duel: chuyển đan giữa người chơi (tổng bằng 0).

## Điều đã chỉnh khi thêm nội dung

- Giới hạn ngày của bí cảnh hạ từ 600 / 4 / 200 xuống **400 / 2 / 40**. Bản đầu cho cống hiến gấp 7 lần cả nền kinh tế cũ.
- Thưởng nhiệm vụ học tập và trảm yêu hạ còn 1–2 đan, 15–25 cống hiến mỗi nhiệm vụ.
- Bài luyện Tàng Kinh Các giới hạn 2 lần/ngày (mỗi lần nộp tốn 1 lượt chạy JDoodle).

## Chờ Bill chốt

- Thưởng 4 bậc thiên kiếp (`TRIBULATION_TIERS`): đang để 500 / 900 / 1 800 / 4 000 XP và 5 / 8 / 15 / 30 đan.
- Thưởng boss tuần (300 XP, 5 đan, 100 cống hiến cho ai gây ≥ 1% máu).
