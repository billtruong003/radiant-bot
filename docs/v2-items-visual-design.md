# V2 Items & Visual Design — Radiant Tech Sect Bot

> Design document for the next major feature wave.  
> Scope: multi-slot equipment, pháp khí, expanded công pháp lore, shop UI overhaul, profile visuals, đơn phương miễu sát mechanic.

---

## 0. Tổng quan thay đổi

| Area | Hiện tại | V2 |
|---|---|---|
| Equipment slots | 1 (công pháp) | 4 (công pháp + pháp khí + 2 nhẫn) |
| Công pháp count | 12 items, ít lore | 27 items, có school + icon + lore dày |
| Pháp khí | Không có (chỉ arena weapon) | 10 items, 1 slot equip, stat buff |
| Shop UI | Text-only embed | Embed + Select Menu + Buttons |
| Profile | Text stats + màu rank | Aura emoji border + equipment panel |
| Inventory command | Pills/CP + công pháp list | "Nhẫn Trữ Vật" frame + slot grid |
| Duel (PvP) | Combat formula bình thường | Đơn phương miễu sát khi gap ≥ 2 cảnh giới |

---

## 1. Schema Changes — `src/db/types.ts`

### 1.1 User (thêm slots)

```typescript
export interface User extends Record<string, unknown> {
  // ... existing fields unchanged ...

  // === V2 equipment slots ===
  equipped_cong_phap_slug?: string | null;   // giữ nguyên (slot 1: công pháp)
  equipped_phap_khi_slug?: string | null;    // MỚI (slot 2: pháp khí, 1 slot)
  equipped_ring_slugs?: string[] | null;     // MỚI (slot 3+4: nhẫn, tối đa 2)
  // Note: armor slot để phase sau, khi có đủ content
}
```

> **Tại sao không thêm armor ngay?** Để tránh scope creep — thêm slot mà không có item fill thì UI trông trống. Armor phase sau khi content sẵn sàng.

### 1.2 CongPhap (mở rộng)

```typescript
export type CongPhapSchool =
  | 'kiem_phap'   // Kiếm Pháp — sword techniques
  | 'than_phap'   // Thân Pháp — movement/agility
  | 'noi_cong'    // Nội Công — internal energy
  | 'luyen_the'   // Luyện Thể — body tempering
  | 'phap_thuat'  // Pháp Thuật — spell arts
  | 'am_duong'    // Âm Dương — yin-yang balance
  | 'ngu_hanh'    // Ngũ Hành — five elements
  | 'thien_ma'    // Thiên Ma — demonic arts
  | 'tuyen_sinh'; // Tuyền Sinh — life cultivation

export interface CongPhap extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  icon: string;           // MỚI — emoji icon, e.g. "⚔️", "🌀", "🔥"
  school: CongPhapSchool; // MỚI — trường phái
  description: string;    // short tagline (1-2 câu, hiện trong shop)
  lore: string;           // MỚI — lore đầy đủ (3-5 câu, hiện trong /cong-phap info)
  passive_text: string;   // MỚI — mô tả hiệu ứng bị động human-readable
  rarity: CongPhapRarity;
  cost_pills: number;
  cost_contribution: number;
  stat_bonuses: {
    combat_power: number;
    xp_multiplier?: number;     // % bonus XP mỗi tin nhắn (vd 0.1 = +10%)
    pill_discount?: number;     // % giảm đan dược cho tribulation (0.05 = -5%)
  };
  min_rank_required: CultivationRankId | null;
  created_at: number;
}
```

### 1.3 PhapKhi (mới hoàn toàn)

```typescript
export type PhapKhiRarity = 'rare' | 'epic' | 'legendary' | 'tien_khi';
export type PhapKhiType =
  | 'kiem'     // kiếm
  | 'truc'     // trượng/trục
  | 'canh'     // chuông/khánh (sound weapon)
  | 'dinh'     // đỉnh/lư (cauldron)
  | 'phan'     // phiến/扇 (fan)
  | 'bao'      // bảo vật khác;

/**
 * Pháp khí — magic treasure. Only ONE can be equipped at a time.
 * Unlike công pháp (technique), pháp khí is a physical artifact with
 * a spiritual imprint. Seeded from phap-khi-catalog.json at startup.
 */
export interface PhapKhi extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  icon: string;             // emoji display in messages
  type: PhapKhiType;
  description: string;      // short tagline
  lore: string;             // full lore paragraph
  passive_text: string;     // human-readable passive effect
  rarity: PhapKhiRarity;
  cost_pills: number;
  cost_contribution: number;
  stat_bonuses: {
    combat_power: number;
    xp_multiplier?: number;
    pill_discount?: number;
    duel_damage_bonus?: number;   // flat bonus damage in PvP duel
  };
  min_rank_required: CultivationRankId | null;
  visual_aura?: string;     // emoji decorating profile when equipped
  created_at: number;
}

export interface UserPhapKhi extends Record<string, unknown> {
  id: string;
  discord_id: string;
  phap_khi_slug: string;
  acquired_at: number;
}
```

### 1.4 Ring items (Nhẫn)

```typescript
export type NhanRarity = 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * Nhẫn (ring) — wearable accessories. Up to 2 can be equipped.
 * Seeded from nhan-catalog.json.
 */
export interface Nhan extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  icon: string;          // emoji e.g. "💍"
  description: string;
  lore: string;
  rarity: NhanRarity;
  cost_pills: number;
  cost_contribution: number;
  stat_bonuses: {
    combat_power: number;
    xp_multiplier?: number;
    pill_discount?: number;
  };
  min_rank_required: CultivationRankId | null;
  created_at: number;
}

export interface UserNhan extends Record<string, unknown> {
  id: string;
  discord_id: string;
  nhan_slug: string;
  acquired_at: number;
}
```

---

## 2. Công Pháp Catalog Mở Rộng — 27 Items

### Bảng tổng quan

| # | Slug | Tên | School | Rarity | Icon | CP | Min Rank |
|---|---|---|---|---|---|---|---|
| 1 | ngu-hanh-quyen | Ngũ Hành Quyền | ngu_hanh | common | 🌊 | 50 | — |
| 2 | thanh-phong-bo | Thanh Phong Bộ | than_phap | common | 💨 | 60 | — |
| 3 | bach-tuong-quan | Bạch Tượng Quán | luyen_the | common | 🐘 | 70 | — |
| 4 | minh-vuong-thach-quyen | Minh Vương Thạch Quyền | luyen_the | common | ⛏️ | 80 | — |
| 5 | kim-cang-quyen | Kim Cang Quyền | luyen_the | rare | 🛡️ | 120 | luyen_khi |
| 6 | hoa-long-chuong | Hỏa Long Chưởng | phap_thuat | rare | 🔥 | 140 | luyen_khi |
| 7 | bang-tam-quyet | Băng Tâm Quyết | phap_thuat | rare | 🧊 | 150 | luyen_khi |
| 8 | huyen-thien-kiem-quyet | Huyền Thiên Kiếm Quyết | kiem_phap | rare | ⚔️ | 180 | truc_co |
| 9 | luu-quang-than-phap | Lưu Quang Thân Pháp | than_phap | rare | ⚡ | 200 | truc_co |
| 10 | van-du-than-phap | Vân Du Thân Pháp | than_phap | rare | ☁️ | 190 | truc_co |
| 11 | thiet-xuong-quyen | Thiết Xương Quyền | luyen_the | rare | 🦴 | 210 | truc_co |
| 12 | kim-dan-luyen-the | Kim Đan Luyện Thể | luyen_the | epic | 🌟 | 350 | kim_dan |
| 13 | ngoc-nu-tam-kinh | Ngọc Nữ Tâm Kinh | am_duong | epic | 🌸 | 370 | kim_dan |
| 14 | that-sat-kiem-quyet | Thất Sát Kiếm Quyết | kiem_phap | epic | 🗡️ | 420 | nguyen_anh |
| 15 | nguyen-anh-tam-phap | Nguyên Anh Tâm Pháp | noi_cong | epic | 🌀 | 500 | nguyen_anh |
| 16 | van-doc-kinh | Vạn Độc Kinh | thien_ma | epic | ☠️ | 480 | nguyen_anh |
| 17 | hon-nguyen-than-quyet | Hỗn Nguyên Thần Quyết | noi_cong | epic | 🌌 | 550 | hoa_than |
| 18 | thien-ma-giai-the | Thiên Ma Giải Thể | thien_ma | epic | 👁️ | 600 | hoa_than |
| 19 | sinh-tu-phu | Sinh Tử Phù | tuyen_sinh | legendary | 🌿 | 900 | luyen_hu |
| 20 | bat-hoang-loi-phap | Bát Hoang Lôi Pháp | phap_thuat | legendary | ⚡ | 950 | luyen_hu |
| 21 | luc-dao-luan-hoi | Lục Đạo Luân Hồi | am_duong | legendary | ♾️ | 1000 | luyen_hu |
| 22 | kiem-tam-thong-minh | Kiếm Tâm Thông Minh | kiem_phap | legendary | 💎 | 1100 | hop_the |
| 23 | nhat-nguyet-huyen-cong | Nhật Nguyệt Huyền Công | am_duong | legendary | 🌙 | 1200 | hop_the |
| 24 | thai-thuong-vong-tinh | Thái Thượng Vong Tình | noi_cong | legendary | ❄️ | 1500 | hop_the |
| 25 | cuu-long-huyet-cong | Cửu Long Huyết Công | luyen_the | legendary | 🐉 | 1600 | dai_thua |
| 26 | thien-dao-vo-thuong | Thiên Đạo Vô Thượng | phap_thuat | legendary | ✨ | 2500 | dai_thua |
| 27 | truong-sinh-quyet | Trường Sinh Quyết | tuyen_sinh | legendary | 🌸 | 5000 | do_kiep |

---

## 3. Lore Chi Tiết Công Pháp

### Common

#### 🌊 Ngũ Hành Quyền
- **Trường phái:** Ngũ Hành
- **Tagline:** Quyền pháp khởi đầu — vận khí năm hành điều hoà.
- **Lore:** Một trong những pháp quyết phổ biến nhất được truyền đời trong giới tu tiên. Ngũ Hành Quyền không phải là pháp môn mạnh nhất, nhưng lại là nền tảng vững chắc nhất — kẻ nào nắm rõ ngũ hành tương sinh tương khắc sẽ thấu hiểu cội rễ của vạn pháp. Dù kẻ tầm thường cũng luyện được, nhưng chỉ người đạt đạo tâm mới thực sự khai ngộ toàn bộ sức mạnh tiềm ẩn của nó.
- **Passive:** Tăng khả năng tiếp thu — +5% XP từ tin nhắn khi đang kết hợp với một pháp khí Ngũ Hành.

#### 💨 Thanh Phong Bộ
- **Trường phái:** Thân Pháp
- **Tagline:** Khinh công nhẹ nhàng — bước đi như gió thoảng.
- **Lore:** Pháp môn khinh công sơ cấp được lưu truyền từ thời kỳ tiền tu tiên. Thanh Phong Bộ dạy người tu luyện hoà khí nhập thể, mượn sức gió để giảm trọng lượng bản thân. Tương truyền tổ sư của bộ pháp này là một tu sĩ lang thang, cả đời không tranh đấu — nhưng chưa ai đuổi kịp bóng ông.
- **Passive:** Tốc độ di chuyển linh hoạt — không có penalty khi đổi target trong PvP.

#### 🐘 Bạch Tượng Quán
- **Trường phái:** Luyện Thể  
- **Tagline:** Luyện thân vững chắc như bạch tượng thần thú.
- **Lore:** Pháp môn luyện thể dựa trên tư thế và hình dáng của Bạch Tượng thần thú — loài thú linh từ tây phương thần đất. Người tu luyện Bạch Tượng Quán không chú trọng tốc độ mà tập trung hoàn thiện khả năng chịu đựng. Mỗi đòn đánh vào người luyện pháp này đều như đánh vào tảng đá.
- **Passive:** +5% kháng sát thương trong duel.

#### ⛏️ Minh Vương Thạch Quyền
- **Trường phái:** Luyện Thể
- **Tagline:** Quyền pháp mô phỏng sức mạnh đất đá — chắc và nặng.
- **Lore:** Xuất xứ từ các tu sĩ thợ mỏ tại vùng Kim Quặng Sơn, Minh Vương Thạch Quyền là pháp môn luyện thể mộc mạc nhưng thực dụng. Không hoa mỹ, không kỳ ảo — chỉ là lực lượng thuần túy được nén chặt qua hàng nghìn lần va chạm với đá quặng. Những người hành nghề thợ rèn và thợ đào thường ưa chuộng quyền pháp này.
- **Passive:** Không có XP bonus nhưng tăng xác suất đạt điểm cống hiến từ daily quest.

---

### Rare

#### 🛡️ Kim Cang Quyền
- **Trường phái:** Luyện Thể
- **Tagline:** Cứng như kim cương, công vào hộ thể.
- **Lore:** Pháp môn được đúc kết bởi một luyện thể đại sư đã từng chịu đựng 3 lần thiên kiếp mà không hề bị thương. Kim Cang Quyền vận khí bao quanh thân thể, tạo thành lớp hộ thể cương quang vô hình nhưng cực kỳ bền chắc. Người sử dụng Kim Cang Quyền được xưng là "người không thể bị hạ gục bằng thương thế".
- **Passive:** Giảm 5% sát thương nhận vào từ mọi nguồn.

#### 🔥 Hỏa Long Chưởng
- **Trường phái:** Pháp Thuật
- **Tagline:** Triệu hồi thần hỏa từ đơn điền, đả kích bằng chưởng hỏa.
- **Lore:** Pháp môn công kích mượn lửa địa ngục từ dưới đơn điền phun ra qua bàn tay. Hỏa Long Chưởng có nguồn gốc từ Hỏa Linh Tông — một tông phái tà đạo đã bị diệt năm trăm năm trước. Kỳ lạ thay, sau khi tông phái bị xóa sổ, pháp môn này lại lan rộng ra khắp chánh đạo — bằng chứng rằng lửa không phân biệt thiện ác.
- **Passive:** +10% sát thương lửa trong arena (khi pháp khí loại "lửa" được trang bị).

#### 🧊 Băng Tâm Quyết
- **Trường phái:** Pháp Thuật
- **Tagline:** Đóng băng ý chí, giữ tâm lạnh như băng tuyết.
- **Lore:** Không phải pháp môn chiến đấu — Băng Tâm Quyết là pháp môn tu tâm. Người luyện thành công có thể giữ ý chí bình thản trong mọi hoàn cảnh, không bị cảm xúc chi phối. Tuy nhiên, ít ai biết rằng khi đạt đến cảnh giới tối cao, pháp môn này có thể hạ nhiệt độ xung quanh xuống đến mức không khí đóng băng.
- **Passive:** Giảm 10% xác suất bị hiệu ứng "rối loạn" trong tribulation event.

#### ⚔️ Huyền Thiên Kiếm Quyết  
- **Trường phái:** Kiếm Pháp
- **Tagline:** Kiếm pháp cổ truyền — một kiếm chấn động trời xanh.
- **Lore:** Lưu truyền từ thời Thượng Cổ, Huyền Thiên Kiếm Quyết được khắc trên tảng đá thần tại đỉnh Thiên Huyền Sơn. Pháp quyết này thuần túy chỉ dạy một điều — cách đâm thẳng. Nhưng cú đâm đó được tôi luyện đến mức hoàn mỹ: nhanh như sấm sét, mạnh như vách núi.
- **Passive:** Tăng 15% sát thương khi ra đòn đầu tiên trong duel.

#### ⚡ Lưu Quang Thân Pháp
- **Trường phái:** Thân Pháp
- **Tagline:** Tốc độ vượt trội — di chuyển nhanh như tia chớp.
- **Lore:** Pháp môn thuần tốc độ — tất cả mọi khía cạnh của Lưu Quang Thân Pháp đều hướng đến một mục tiêu: đến nơi trước đối thủ kịp nhận ra. Người luyện thành pháp môn này được mô tả là "như không tồn tại tại nơi người ta thấy họ". Ánh chớp mà người ta thấy chỉ là di ảnh.
- **Passive:** Ưu tiên ra đòn đầu tiên trong mọi duel (+1 round advantage).

#### ☁️ Vân Du Thân Pháp
- **Trường phái:** Thân Pháp
- **Tagline:** Mượn hình mây, du hành tự tại — đến rồi đi không để dấu vết.
- **Lore:** Khác với Lưu Quang Thân Pháp tập trung vào tốc độ thô, Vân Du Thân Pháp học theo bản chất của mây — vô hình, biến ảo, không thể nắm bắt. Người luyện thành công có thể di chuyển hoàn toàn im lặng và không để lại dấu khí tức. Nhiều Ám Vệ và thám tử tu tiên ưa dùng pháp môn này.
- **Passive:** Ẩn danh trong leaderboard công khai (tùy chọn bật/tắt).

#### 🦴 Thiết Xương Quyền
- **Trường phái:** Luyện Thể
- **Tagline:** Luyện xương cốt thành sắt thép — thân thể là vũ khí.
- **Lore:** Pháp môn luyện thể cực đoan — thay vì luyện cơ bắp hay nội khí, Thiết Xương Quyền nhắm thẳng vào xương cốt, tôi luyện chúng cho đến khi cứng hơn cả kim khí thường. Quá trình luyện tập vô cùng đau đớn và kéo dài nhiều năm, nhưng kết quả là một thân thể gần như bất hoại đối với vũ khí tầm thường.
- **Passive:** Kháng sát thương vật lý 10% trong PvP.

---

### Epic

#### 🌟 Kim Đan Luyện Thể
- **Trường phái:** Luyện Thể
- **Tagline:** Luyện nội đan thành hình — sức mạnh tăng tiến vượt bậc.
- **Lore:** Khi tu sĩ ngưng tụ Kim Đan, phần lớn chỉ biết giữ gìn đan điền — Kim Đan Luyện Thể dạy điều ngược lại: hãy đẩy toàn bộ năng lượng của Kim Đan vào thân xác. Thân thể sẽ đau như vỡ vụn trong ba ngày đầu. Nhưng khi qua được thử thách đó, người tu luyện sẽ đạt đến một tầm cao mà thân thể phàm nhân không thể với tới.
- **Passive:** +8% XP từ voice channel; Kim Đan ổn định cho phép thiền định hiệu quả hơn.

#### 🌸 Ngọc Nữ Tâm Kinh
- **Trường phái:** Âm Dương
- **Tagline:** Bí pháp dung hòa âm dương — nhu mà bất bại.
- **Lore:** Ngọc Nữ Tâm Kinh là pháp môn cực kỳ hiếm gặp — dựa trên nguyên lý âm dương hài hòa thay vì đối kháng. Không có đòn tấn công mạnh mẽ, không có phòng thủ cứng rắn — mà là một trạng thái cân bằng hoàn hảo khiến đối thủ không thể tìm ra điểm yếu. Tương truyền chỉ người có tâm hồn trong sáng mới có thể luyện thành công pháp môn này.
- **Passive:** Trong duel, mỗi lần bị tấn công có 15% cơ hội phản đòn +20% damage.

#### 🗡️ Thất Sát Kiếm Quyết
- **Trường phái:** Kiếm Pháp
- **Tagline:** Bảy đường kiếm khí, mỗi đường là một lần sát ý.
- **Lore:** Thất Sát Kiếm Quyết không phải pháp môn dành cho người yếu tim. Bảy đường kiếm khí tương ứng với bảy loại sát ý khác nhau: sát ý vì tức giận, vì lạnh lùng, vì tuyệt vọng, vì bảo vệ, vì trừng phạt, vì thử thách, và vì... quên lý do. Người luyện thành công Thất Sát thường trở nên cô độc, vì năng lượng sát khí vô tình đẩy xa những người xung quanh.
- **Passive:** +20% crit chance trong PvP duel.

#### 🌀 Nguyên Anh Tâm Pháp
- **Trường phái:** Nội Công
- **Tagline:** Tu luyện Nguyên Anh — đạo tâm bất hoại, lực chiến nhân ba.
- **Lore:** Khi Nguyên Anh hình thành, tu sĩ bước vào một thế giới hoàn toàn khác — ý thức có thể tách khỏi thân xác và du hành trong hư không. Nguyên Anh Tâm Pháp hướng dẫn tu sĩ tôi luyện Nguyên Anh ngay từ ban đầu, không phải để tách rời thân xác mà để hợp nhất hoàn toàn — thân tâm nhất thể, sức mạnh tăng gấp nhiều lần.
- **Passive:** +15% XP từ mọi nguồn; Nguyên Anh ổn định tăng khả năng tiếp thu kiến thức.

#### ☠️ Vạn Độc Kinh
- **Trường phái:** Thiên Ma
- **Tagline:** Thuốc độc là đạo — kẻ trăm độc không xâm cũng kẻ gieo độc vào đời.
- **Lore:** Một trong những pháp môn tối ám nhất tồn tại trong giới tu tiên. Vạn Độc Kinh dạy người tu luyện hiểu và kiểm soát mọi loại độc tố — từ cơ thể có thể tiết ra độc khí, nước mắt có thể làm kim loại tan chảy. Chánh đạo và tà đạo đều muốn tiêu diệt pháp môn này, nhưng không ai có thể — vì người nắm giữ nó luôn biết cách thoát thân trước khi bị bắt.
- **Passive:** Trong PvP, 10% cơ hội đầu độc đối thủ (mất 5 HP/round thêm 2 round).

#### 🌌 Hỗn Nguyên Thần Quyết
- **Trường phái:** Nội Công
- **Tagline:** Vận dụng khí hỗn nguyên từ buổi khai thiên — vô thủy vô chung.
- **Lore:** Hỗn Nguyên là trạng thái vũ trụ trước khi có âm dương phân chia — hư vô và viên mãn. Hỗn Nguyên Thần Quyết không dạy kỹ thuật chiến đấu hay luyện thể — nó dạy cách nhập vào trạng thái nguyên sơ đó trong một khoảnh khắc, khiến toàn bộ công lực bùng phát tự nhiên mà không cần kiểm soát. Nguy hiểm với người chưa đủ đạo tâm, nhưng với người đủ kinh nghiệm — uy lực không thể đo lường.
- **Passive:** Mỗi 50 level-up tích lũy từ khi equip, tặng 1 đan dược bổ sung.

#### 👁️ Thiên Ma Giải Thể
- **Trường phái:** Thiên Ma
- **Tagline:** Tà công cổ xưa — mạnh nhưng có giá phải trả.
- **Lore:** Thiên Ma Giải Thể không phải pháp môn được tạo ra bởi con người — nó được "truyền" vào một tu sĩ trong một cơn ác mộng tại vùng đất ma chú. Người luyện thành công sẽ nghe thấy một giọng nói thứ hai trong đầu, nhưng đổi lại là sức mạnh không thể tin được. Giá phải trả là mỗi lần sử dụng tối đa, vài sợi thọ mệnh sẽ bị cắt đứt. Không ai biết giọng nói đó đến từ đâu — nhưng nó không bao giờ im lặng.
- **Passive:** +25% combat power. Nhưng khi duel thất bại, mất thêm 1 đan dược.

---

### Legendary

#### 🌿 Sinh Tử Phù
- **Trường phái:** Tuyền Sinh
- **Tagline:** Phù chú sự sống và cái chết — kẻ luyện thành biết ranh giới của hai thế giới.
- **Lore:** Sinh Tử Phù không phải pháp môn học thuộc mà là pháp môn "ngộ". Khi tu sĩ đã từng đứng trên ranh giới sinh tử ít nhất một lần, họ mới có thể cảm nhận được rung động của phù chú này. Người luyện thành không chỉ kiểm soát sinh lực của mình mà còn có thể cảm nhận tình trạng sức khỏe của người xung quanh — một vũ khí vô hình và vô đối trong các cuộc chiến kéo dài.
- **Passive:** Hồi 5% HP mỗi round trong duel (tối đa 3 round đầu); +5% XP từ mọi nguồn.

#### ⚡ Bát Hoang Lôi Pháp
- **Trường phái:** Pháp Thuật
- **Tagline:** Tám phương lôi đình quy phục — một người, bát hoang đều run.
- **Lore:** Pháp môn kiêu ngạo nhất trong danh sách — Bát Hoang Lôi Pháp không che giấu hay tinh tế. Đây là pháp môn của kẻ muốn cả thế giới biết mình đang chiến đấu. Sấm sét từ tám phương hội tụ, mặt đất rung chuyển, không khí bốc mùi khét. Không có chỗ ẩn náu, không có cách phòng thủ hoàn hảo — chỉ có vụ nổ và im lặng sau đó.
- **Passive:** Trong duel, mỗi đòn tấn công có 20% cơ hội kích hoạt "Lôi Đình" — tăng 50% damage cho đòn đó.

#### ♾️ Lục Đạo Luân Hồi
- **Trường phái:** Âm Dương
- **Tagline:** Luân hồi công pháp — đi qua sinh tử cảnh giới thay đổi.
- **Lore:** Sáu con đường luân hồi — thiên đạo, nhân đạo, tu la, súc sanh, ngạ quỷ, địa ngục — Lục Đạo Luân Hồi là bộ pháp môn không thể hiểu nổi bằng trí tuệ thông thường. Người luyện thành phải chứng kiến tất cả sáu đạo trong thiền định, trải qua ký ức của mọi kiếp sống. Phần thưởng là sự hiểu biết về bản chất của hiện thực — và sức mạnh không gì sánh được.
- **Passive:** +12% XP từ tất cả nguồn; khi lên cảnh giới có 5% cơ hội tự động nhận thêm 2 đan dược.

#### 💎 Kiếm Tâm Thông Minh
- **Trường phái:** Kiếm Pháp
- **Tagline:** Không cần kiếm — tâm chính là kiếm bất bại.
- **Lore:** Đỉnh cao của Kiếm Đạo không phải là có kiếm sắc bén nhất hay kỹ thuật tinh thông nhất — mà là đạt đến trạng thái "Kiếm Tâm". Khi tâm trí và kiếm ý hòa quyện hoàn toàn, mọi thứ xung quanh đều có thể trở thành kiếm: gió, ánh sáng, lời nói, thậm chí sự im lặng. Kẻ đạt Kiếm Tâm Thông Minh không cần rút kiếm — đối thủ đã bại trước khi trận chiến bắt đầu.
- **Passive:** +30% sát thương đòn đầu tiên trong mọi duel; nếu one-shot đối thủ → nhận thêm 3 CP.

#### 🌙 Nhật Nguyệt Huyền Công
- **Trường phái:** Âm Dương
- **Tagline:** Nhật dương nguyệt âm — vận hành không ngừng như thiên địa.
- **Lore:** Nếu Ngọc Nữ Tâm Kinh là âm dương ở giai đoạn sơ cấp, thì Nhật Nguyệt Huyền Công là âm dương ở tầng tối cao. Công pháp này liên kết trực tiếp với chu kỳ mặt trời và mặt trăng — ban ngày dương khí mạnh hơn, ban đêm âm khí phát huy. Người luyện thành sẽ liên tục dao động giữa hai trạng thái, không bao giờ chạm đến điểm tối đa hay tối thiểu — một dòng chảy bất tận.
- **Passive:** +10% combat power ban ngày (6:00-18:00 giờ VN); +10% XP ban đêm.

#### ❄️ Thái Thượng Vong Tình
- **Trường phái:** Nội Công
- **Tagline:** Tuyệt học của Thái Thượng tổ sư — quên tình, đạt đạo tâm.
- **Lore:** Thái Thượng tổ sư là người đầu tiên đạt đến cảnh giới "Vong Tình" — quên hết mọi cảm xúc, chỉ còn lại đạo. Không phải vô cảm mà là siêu cảm — nhìn thấy vạn vật mà không bị chúng lay chuyển. Truyền thuyết kể rằng khi tổ sư viên tịch, không ai thấy ông — chỉ thấy một tờ giấy với năm chữ: "Tình không cần, đạo tự tại". Người học pháp môn này thường bị người thân cho là "lạnh lùng" — nhưng họ chưa hiểu sự khác biệt giữa lạnh lùng và siêu thoát.
- **Passive:** Hoàn toàn miễn nhiễm với các hiệu ứng "rối loạn" và "sợ hãi" trong tribulation; +20% CP.

#### 🐉 Cửu Long Huyết Công
- **Trường phái:** Luyện Thể
- **Tagline:** Huyết mạch chín con rồng — thân thể đạt đỉnh cao của vũ lực.
- **Lore:** Không ai biết ai đã tạo ra Cửu Long Huyết Công — chỉ biết rằng nó được viết bằng máu rồng thật trên da người. Người luyện thành phải trải qua quá trình biến đổi thân thể đau đớn khi huyết mạch chín rồng dần hình thành trong cơ thể. Kết quả là một thân thể không khác gì một con rồng thứ mười — sức mạnh, tốc độ, và khả năng chịu đựng đều vượt ngoài phàm trần.
- **Passive:** +35% combat power; trong duel thắng liên tiếp 3 lần → nhận danh hiệu tạm thời "Rồng Chiến".

#### ✨ Thiên Đạo Vô Thượng
- **Trường phái:** Pháp Thuật
- **Tagline:** Đỉnh cao công pháp — đồng hành thiên đạo, đại đạo tự nhiên.
- **Lore:** Thiên Đạo Vô Thượng không phải do con người sáng tạo — nó là sự ghi lại những quy luật tồn tại từ khi vũ trụ hình thành. Người đọc được pháp quyết này không "học" mà "nhớ lại" — như thể linh hồn họ đã biết từ kiếp trước. Kẻ luyện thành sẽ nghe được tiếng thì thầm của Thiên Đạo — mọi điều xảy ra đều có lý, mọi thắng bại đều trong tầm tay.
- **Passive:** +40% CP; có thể cảm nhận điểm yếu của đối thủ — tăng 10% crit multiplier.

#### 🌸 Trường Sinh Quyết
- **Trường phái:** Tuyền Sinh
- **Tagline:** Bí pháp Tiên Nhân — kéo dài tuổi thọ, đạo tâm bất hoại.
- **Lore:** Đây là pháp môn không ai luyện thành trong vòng một kiếp sống. Trường Sinh Quyết đòi hỏi tu sĩ phải trải qua kiếp Độ Kiếp hoàn chỉnh — chứng kiến sự mất mát, đau khổ, và vẫn chọn tồn tại. Người luyện thành không chỉ kéo dài tuổi thọ của bản thân mà còn có thể chia sẻ một phần sinh lực với người khác. Trong lịch sử tu tiên, chỉ có bảy người luyện thành pháp môn này — và tất cả đều đã đạt Tiên Nhân cảnh giới.
- **Passive:** Kết hợp tất cả bonus của các pháp môn Tuyền Sinh; cực kỳ hiếm — chỉ dành cho ai kiên trì đến Độ Kiếp.

---

## 4. Pháp Khí Catalog — 10 Items

> Pháp khí là vật phẩm linh thiêng, chỉ trang bị được **1 cái** cùng lúc. Khác với công pháp (kỹ thuật), pháp khí là vật thể vật lý gắn với linh hồn tu sĩ.

### Bảng tổng quan

| # | Slug | Tên | Type | Rarity | Icon | CP | Min Rank |
|---|---|---|---|---|---|---|---|
| 1 | thanh-phong-linh-truc | Thanh Phong Linh Trục | truc | rare | 🪄 | 100 | luyen_khi |
| 2 | huyen-thiet-kiem | Huyền Thiết Kiếm | kiem | rare | 🗡️ | 130 | truc_co |
| 3 | binh-hai-than-tram | Bích Hải Thần Trâm | truc | epic | 🪡 | 280 | kim_dan |
| 4 | hoa-long-phien | Hỏa Long Phiến | phan | epic | 🪭 | 300 | kim_dan |
| 5 | huyen-minh-bao-dinh | Huyền Minh Bảo Đỉnh | dinh | epic | 🏺 | 350 | nguyen_anh |
| 6 | loi-bong-thien-kich | Lôi Bổng Thiên Khích | truc | epic | ⚡ | 400 | hoa_than |
| 7 | van-kiem-quy-tong-dinh | Vạn Kiếm Quy Tông Đỉnh | dinh | legendary | 🔱 | 800 | luyen_hu |
| 8 | hon-don-khanh | Hỗn Độn Khánh | canh | legendary | 🔔 | 900 | hop_the |
| 9 | tu-kim-hong-ho-lo | Tử Kim Hồng Hồ Lô | bao | legendary | 🫙 | 1000 | dai_thua |
| 10 | thai-cuc-do | Thái Cực Đồ | bao | tien_khi | ☯️ | 3000 | do_kiep |

### Lore Pháp Khí

#### 🪄 Thanh Phong Linh Trục
- **Loại:** Trượng linh
- **Tagline:** Cây trượng tre thần — từng thuộc về một đạo sĩ hành cước ẩn danh.
- **Lore:** Không ai biết tên người đã tạo ra Thanh Phong Linh Trục. Chỉ biết rằng cây trượng này được tìm thấy cắm giữa đỉnh núi — không có dấu chân nào xung quanh, không có ghi chú nào. Những ai chạm vào nó đều cảm thấy một làn gió mát lành thổi qua lòng bàn tay, như thể cây trượng đang hít thở. Không phải vũ khí mạnh nhất, nhưng là pháp khí "sống" nhất.
- **Passive:** Tăng tốc độ di chuyển ảo (trong lore); +100 CP; kết hợp với thân pháp công pháp → +50 CP bonus thêm.

#### 🗡️ Huyền Thiết Kiếm
- **Loại:** Kiếm linh
- **Tagline:** Đúc từ quặng huyền thiết tại đáy biển — kiếm không có hình, chỉ có ý.
- **Lore:** Huyền Thiết là loại quặng chỉ tồn tại ở áp suất cực cao dưới đáy biển sâu nhất. Người thợ rèn đúc ra Huyền Thiết Kiếm đã phải mất ba mươi năm chỉ để tìm đủ nguyên liệu. Lưỡi kiếm trông đen tuyền nhưng khi ánh sáng chiếu vào từ đúng góc, lại hiện ra màu tím thẳm như bầu trời nửa đêm. Mỗi đêm kiếm tự mài bản thân — không cần người chủ động.
- **Passive:** +130 CP; tăng 10% sát thương trong duel ban đêm (18:00-6:00 VN).

#### 🪡 Bích Hải Thần Trâm  
- **Loại:** Trâm thần (needle)
- **Tagline:** Trâm ngọc bích — nhỏ như sợi chỉ nhưng xuyên thủng cả kim cương.
- **Lore:** Kích thước chỉ bằng một chiếc kim khâu, nhưng Bích Hải Thần Trâm là pháp khí gây sợ hãi nhất trong giới tu tiên tầm trung. Không ai thấy trâm ra đời — nó chỉ xuất hiện và biến mất, len lỏi qua mọi phòng hộ như không tồn tại. Người chủ của trâm chỉ cần nghĩ đến mục tiêu là trâm đã đến nơi trước khi bất kỳ ai kịp nhận ra.
- **Passive:** +280 CP; trong duel có 15% cơ hội bỏ qua toàn bộ phòng thủ của đối thủ.

#### 🪭 Hỏa Long Phiến
- **Loại:** Phiến bảo (magic fan)
- **Tagline:** Chiếc quạt của nữ tu sĩ hỏa hệ — một cái phe nhẹ thiêu rụi đồi núi.
- **Lore:** Hỏa Long Phiến trông như một chiếc quạt giấy bình thường với họa tiết rồng đỏ. Nhưng khi được khai mở, nó trở thành cổng dẫn vào Hỏa Địa Ngục — nguồn nhiệt độ không thể đo được. Người chủ của quạt này không bao giờ thấy lạnh — ngay cả trong tuyết lạnh âm mươi độ, xung quanh họ vẫn ấm áp như mùa xuân. Nhược điểm duy nhất: người gần họ quá lâu đôi khi bị bỏng nhẹ.
- **Passive:** +300 CP; kết hợp với Hỏa Long Chưởng → +100 CP bonus thêm; "aura lửa" hiển thị trong profile.

#### 🏺 Huyền Minh Bảo Đỉnh
- **Loại:** Đỉnh bảo (cauldron)
- **Tagline:** Bảo đỉnh của đan sư thượng cổ — luyện đan trong nó không bao giờ thất bại.
- **Lore:** Huyền Minh Bảo Đỉnh không phải vũ khí chiến đấu — nhưng nó là thứ mà mọi đan sư đều muốn sở hữu. Đỉnh này tự động tinh lọc dược liệu, tự điều chỉnh nhiệt độ, và thậm chí có thể "sửa lỗi" khi quá trình luyện đan bị sai. Tương truyền Huyền Minh Bảo Đỉnh đã giúp luyện thành 99 loại thần đan — chỉ thiếu mỗi loại thứ 100, vì không ai tìm ra đủ nguyên liệu.
- **Passive:** +350 CP; giảm 10% chi phí đan dược cho mọi giao dịch shop.

#### ⚡ Lôi Bổng Thiên Khích
- **Loại:** Bổng thần (thunder staff)
- **Tagline:** Gậy lôi thiên — tiếng nổ vang tận cửu thiên.
- **Lore:** Lôi Bổng Thiên Khích được đúc bằng gỗ cây Lôi Mộc — loài cây bị sét đánh hàng triệu lần mà không chết, thay vào đó hấp thụ và tích trữ toàn bộ điện năng. Sau khi đúc xong, bổng thần này phát ra tiếng vo ve liên tục ngay cả khi đặt trong bao kiếm. Mỗi lần đập xuống đất, đất rạn nứt theo hình tia sét. Người cầm gậy này luôn cảm thấy tóc dựng ngược — nhưng họ không bận tâm.
- **Passive:** +400 CP; trong duel có 25% cơ hội gây thêm "sét đánh" (10% max HP damage).

#### 🔱 Vạn Kiếm Quy Tông Đỉnh
- **Loại:** Đỉnh thần cấp legendary
- **Tagline:** Đỉnh thần triệu tập vạn kiếm — người cầm đứng trên đỉnh thiên hạ.
- **Lore:** Đỉnh này không chứa đan — nó chứa kiếm. Hàng vạn thanh kiếm linh đã hy sinh bản thân để gia nhập vào Vạn Kiếm Quy Tông Đỉnh, tan chảy thành một khối năng lượng kiếm ý thuần túy. Khi chủ nhân khai mở đỉnh, hàng ngàn kiếm khí bắn ra mọi hướng — không phân biệt bạn thù. Người sử dụng pháp khí này phải luôn giữ tâm tĩnh lặng tuyệt đối, nếu không chính mình sẽ là nạn nhân đầu tiên.
- **Passive:** +800 CP; trong duel, cứ 2 round lại kích hoạt "Vạn Kiếm" — tấn công 3 lần liên tiếp trong 1 round.

#### 🔔 Hỗn Độn Khánh
- **Loại:** Khánh thần (bell)
- **Tagline:** Tiếng khánh vang — xé toạc hư không, khai mở chân lý.
- **Lore:** Hỗn Độn Khánh không đánh — nó vang. Tiếng khánh này có thể phá vỡ bất kỳ kết giới nào, hóa giải bất kỳ pháp thuật nào, và thậm chí "đánh thức" những pháp bảo đang ngủ yên. Nhưng tác dụng kỳ lạ nhất: khi vang trong không gian yên tĩnh, khánh có thể tạm thời cho phép người nghe nhìn thấy "các lớp" của thực tại — như nhìn qua kính đa chiều. Người sử dụng báo cáo rằng sau khi nghe khánh, họ không bao giờ nhìn thế giới theo cách cũ nữa.
- **Passive:** +900 CP; vô hiệu hóa 1 lần hiệu ứng bất lợi trong duel mỗi trận.

#### 🫙 Tử Kim Hồng Hồ Lô
- **Loại:** Hồ lô (gourd)
- **Tagline:** Bầu hồ lô màu tím vàng — nuốt được cả thần tiên vào trong.
- **Lore:** Tương truyền Tử Kim Hồng Hồ Lô có thể nuốt chửng bất cứ thứ gì — từ vũ khí, pháp bảo, cho đến nguyên thần của tu sĩ. Bên trong là một không gian khác hoàn toàn, không có thời gian, không có không gian — chỉ có sự trống rỗng thuần túy. Những gì vào hồ lô này không bao giờ ra được, trừ khi người chủ tự tay rót ra. Điều đáng sợ nhất không phải hồ lô nuốt gì — mà là không ai biết nó có giới hạn dung tích hay không.
- **Passive:** +1000 CP; 1 lần/ngày có thể "nuốt" 1 đòn tấn công của đối thủ trong duel (hoàn toàn miễn nhiễm).

#### ☯️ Thái Cực Đồ
- **Loại:** Bảo đồ cấp Tiên Khí
- **Tagline:** Tranh vẽ thái cực — trong đó chứa toàn bộ bí mật của vũ trụ.
- **Lore:** Thái Cực Đồ không phải do ai tạo ra. Nó tự xuất hiện vào buổi sáng đầu tiên khi vũ trụ hình thành, tự động lưu lại toàn bộ quy luật của đạo. Trong hàng triệu năm, nó trôi dạt qua vô số tay người — mỗi chủ nhân chỉ hiểu được một phần nhỏ của nó trước khi qua đời. Hiện tại ai đang cầm Thái Cực Đồ, ngay cả Thiên Đạo cũng không chắc biết. Người sở hữu pháp bảo này không chiến đấu — họ chỉ cần "tồn tại" là đủ để đối thủ không dám tiếp cận.
- **Passive:** +3000 CP; giảm 20% mọi chi phí; XP tất cả nguồn +20%. Chỉ Độ Kiếp mới mở được.

---

## 5. Nhẫn Catalog — 8 Items (Slot Phụ, Tối Đa 2)

| # | Slug | Tên | Rarity | Icon | CP | Min Rank |
|---|---|---|---|---|---|---|
| 1 | ngoc-tu-nhan | Ngọc Từ Nhẫn | uncommon | 💍 | 30 | — |
| 2 | kim-tinh-nhan | Kim Tinh Nhẫn | rare | 💎 | 80 | luyen_khi |
| 3 | hoa-van-linh-nhan | Hoa Văn Linh Nhẫn | rare | 🌸 | 100 | truc_co |
| 4 | thien-tinh-sa-nhan | Thiên Tinh Sa Nhẫn | epic | ✨ | 200 | kim_dan |
| 5 | loi-quang-nhan | Lôi Quang Nhẫn | epic | ⚡ | 220 | nguyen_anh |
| 6 | ha-do-lo-thu-nhan | Hà Đồ Lạc Thư Nhẫn | epic | 🔮 | 250 | hoa_than |
| 7 | cu-linh-nhan | Cự Linh Nhẫn | legendary | 🌌 | 500 | luyen_hu |
| 8 | truong-sinh-nhan | Trường Sinh Nhẫn | legendary | ☀️ | 700 | do_kiep |

> Nhẫn được bán trong shop tab "Nhẫn" riêng. Tối đa đeo 2 nhẫn đồng thời — CP cộng dồn cả 2.

---

## 6. Shop UI Redesign

### 6.1 Architecture

```
/shop                          → Category picker (Select Menu)
  → "Công Pháp" selected       → Công pháp list (Embed + buttons per item)
  → "Pháp Khí" selected        → Pháp khí list
  → "Nhẫn" selected            → Nhẫn list

Item card click (Button)       → Item detail embed (lore + stats + Buy button)
Buy Button click               → Confirmation prompt → Purchase
```

### 6.2 Category Picker Embed

```
┌──────────────────────────────────────────┐
│  🏪 Thiên Bảo Các — Cửa Hàng Tông Môn   │
│  💊 Đan Dược: 15   |  🏅 Cống Hiến: 320  │
│                                          │
│  Chọn danh mục để xem hàng hoá:         │
│  [📚 Công Pháp] [🔮 Pháp Khí] [💍 Nhẫn] │
└──────────────────────────────────────────┘
        (Select Menu dropdown below)
```

### 6.3 Item List Embed (ví dụ Công Pháp tab)

```
┌──────────────────────────────────────────────┐
│  📚 CÔNG PHÁP — Cửa Hàng Tông Môn           │
│  Cảnh giới của bạn: ⭐ Nguyên Anh            │
├──────────────────────────────────────────────┤
│  🌀 Nguyên Anh Tâm Pháp  [Epic] [Nội Công]  │
│  Tu luyện Nguyên Anh — đạo tâm bất hoại.    │
│  💊 8 đan  🏅 1200 CP  ⚡ +500 LC           │
│  ✅ Đã sở hữu                                │
│                                              │
│  🗡️ Thất Sát Kiếm Quyết  [Epic] [Kiếm Pháp] │
│  Bảy đường kiếm khí, mỗi đường một sát ý.   │
│  💊 6 đan  🏅 900 CP  ⚡ +420 LC            │
│  🟢 Có thể mua                              │
│                                              │
│  🌌 Hỗn Nguyên Thần Quyết  [Epic] [Nội Công]│
│  Vận dụng khí hỗn nguyên từ buổi khai thiên.│
│  💊 12 đan  🏅 1800 CP  ⚡ +550 LC          │
│  🔒 Cần: Hóa Thần                           │
├──────────────────────────────────────────────┤
│  [🗡️ Chi tiết Thất Sát] [📄 Xem thêm...]    │
└──────────────────────────────────────────────┘
```

> **Discord component implementation:**
> - Top: Static Embed
> - Middle: Each item as `EmbedField` with icon + status
> - Bottom: `ActionRow` with buttons for purchasable items (max 5 visible, pagination for more)
> - "Chi tiết" button → ephemeral reply với lore đầy đủ + Buy button

### 6.4 Item Detail + Buy Flow

```
[Chi tiết click] →

┌────────────────────────────────────────────────────┐
│  🗡️ THẤT SÁT KIẾM QUYẾT                           │
│  ◆ Epic  ·  Kiếm Pháp School                      │
├────────────────────────────────────────────────────┤
│  "Bảy đường kiếm khí, mỗi đường là một lần sát ý."│
│                                                    │
│  LORE                                              │
│  Thất Sát Kiếm Quyết không phải pháp môn dành    │
│  cho người yếu tim. Bảy đường kiếm khí...        │
│  [full lore text]                                  │
├────────────────────────────────────────────────────┤
│  THỐNG KÊ                                          │
│  ⚡ Lực Chiến: +420                               │
│  🎯 Passive: +20% crit chance trong duel          │
│                                                    │
│  GIÁ                                              │
│  💊 6 Đan Dược  +  🏅 900 Cống Hiến              │
│  Số dư: 💊 15 đan / 🏅 1,240 CP → ✅ Đủ tiền    │
└────────────────────────────────────────────────────┘
             [✅ Mua ngay]  [❌ Đóng]
```

---

## 7. Profile Visual Redesign

### 7.1 Aura theo Cảnh Giới

| Cảnh Giới | Aura Border | Color |
|---|---|---|
| Phàm Nhân | (none) | #95989e |
| Luyện Khí | 💧💧💧 | #b8c5d0 |
| Trúc Cơ | 🌿🌿🌿 | #7fa6c5 |
| Kim Đan | ✨⭐✨ | #e6c87e |
| Nguyên Anh | 🌀💜🌀 | #b09bd3 |
| Hóa Thần | 🔥❤️🔥 | #d97b8a |
| Luyện Hư | 🌙⚪🌙 | #8fbf9f |
| Hợp Thể | 🌸🔶🌸 | #d4a574 |
| Đại Thừa | ☁️🤍☁️ | #e8eaf0 |
| Độ Kiếp | ⚡💛⚡ | #ffd56b |
| Tiên Nhân | 🌟💖🌟 | #f5e8ff |

### 7.2 Profile Embed Layout

```
┌─────────────────────────────────────────────────────┐
│  🔥❤️🔥  HÓA THẦN · LEVEL 55  🔥❤️🔥             │
│  ══════════════════════════════════════             │
│                                                     │
│  👤 TrùngLong_Tu                                   │
│  📊 XP: 128,450 / 145,000  ████████░░  88.6%       │
│  ⚡ Lực Chiến: 2,840                               │
│                                                     │
│  ══ TRANG BỊ ══════════════════════════           │
│  📚 Công Pháp:  👁️ Thiên Ma Giải Thể              │
│  🔮 Pháp Khí:   🔔 Hỗn Độn Khánh                  │
│  💍 Nhẫn 1:     ⚡ Lôi Quang Nhẫn                 │
│  💍 Nhẫn 2:     — (trống)                         │
│                                                     │
│  ══ TIẾN ĐỘ ══════════════════════════            │
│  💊 Đan dược: 12    🏅 Cống hiến: 890              │
│  🔥 Streak: 7 ngày  📅 Gia nhập: 90 ngày trước    │
│                                                     │
│  [Hóa Thần — Người nói ưu tiên, sticker ngoài]    │
└─────────────────────────────────────────────────────┘
```

### 7.3 Implementation Notes (Emoji-based aura)

Discord không hỗ trợ real visual effects trong embed — giải pháp là:
1. **Aura border**: Hiển thị emoji aura trong embed **title** (vd: `🔥❤️🔥 HÓA THẦN 🔥❤️🔥`)
2. **Equipped items**: Hiển thị icon của item (emoji) trong embed field
3. **Color accent**: Embed border color theo cảnh giới (đã có `colorHex`)
4. **Thumbnail**: Nếu user có avatar → hiển thị. Có thể thêm rank badge overlay (phase sau với canvas)

> **Phase sau (optional):** Dùng `canvas` để vẽ rank badge overlay lên avatar — tương tự cách MEE6 làm levelcard. Tuy nhiên cần cân nhắc performance (canvas render = blocking I/O).

---

## 8. Inventory — "Nhẫn Trữ Vật"

### 8.1 Rebrand

`/inventory` → vẫn là lệnh `/inventory` nhưng tiêu đề đổi thành **"Nhẫn Trữ Vật"** (Storage Ring).  
Theme: tu sĩ trữ đồ trong nhẫn không gian (spatial ring) — thứ không thể thiếu của bất kỳ tu sĩ nào.

### 8.2 Layout mới

```
┌─────────────────────────────────────────────────────┐
│  💍 NHẪN TRỮ VẬT — Kho Báu Cá Nhân               │
├─────────────────────────────────────────────────────┤
│  ══ ĐANG TRANG BỊ ══════════════════════           │
│  📚 [👁️ Thiên Ma Giải Thể]  Công Pháp             │
│  🔮 [🔔 Hỗn Độn Khánh]       Pháp Khí              │
│  💍 [⚡ Lôi Quang Nhẫn]     Nhẫn 1                │
│  💍 [— trống —]              Nhẫn 2                │
│                                                     │
│  ══ TÀI NGUYÊN ══════════════════════              │
│  💊 Đan Dược: 12                                   │
│  🏅 Cống Hiến: 890                                 │
│                                                     │
│  ══ SỞ HỮU (Công Pháp) ════════════════           │
│  👁️ Thiên Ma Giải Thể  [Epic] ← đang equip        │
│  🌀 Nguyên Anh Tâm Pháp  [Epic]                   │
│  🌊 Ngũ Hành Quyền  [Common]                      │
│                                                     │
│  ══ SỞ HỮU (Pháp Khí) ════════════════            │
│  🔔 Hỗn Độn Khánh  [Legendary] ← đang equip       │
│                                                     │
│  ══ SỞ HỮU (Nhẫn) ════════════════════            │
│  ⚡ Lôi Quang Nhẫn  [Epic] ← slot 1               │
└─────────────────────────────────────────────────────┘
```

---

## 9. Đơn Phương Miễu Sát Mechanic

### 9.1 Điều kiện kích hoạt

Khi lệnh duel được accept:
```typescript
const challengerRankIdx = getRankIndex(challenger.cultivation_rank);  // 0-10
const defenderRankIdx   = getRankIndex(defender.cultivation_rank);

const gap = challengerRankIdx - defenderRankIdx;

if (gap >= 2) {
  // Đơn phương miễu sát — skip normal duel simulation
  triggerAnnihilation(challenger, defender, channel);
  return;
}
```

### 9.2 Narration Templates (nhiều variant)

Random chọn 1 trong các template, gồm 2 mood: **miễu sát** (kẻ mạnh dứt khoát) và **khinh đan** (kẻ mạnh khinh thường, không thèm trừ đan dược).

```typescript
const ANNIHILATION_TEMPLATES_PURE = [
  // Gap = 2
  "{A} liếc nhìn {B} — chỉ một tia mắt, thần hồn {B} run rẩy như sắp vỡ vụn.",
  "{A} chưa kịp ra tay, áp lực cảnh giới đã khiến {B} quỳ xuống không tự chủ được.",
  "Như núi Thái Sơn đè lên ngọn cỏ — {B} không còn khả năng kháng cự trước {A}.",

  // Gap = 3
  "{A} chỉ dùng một ánh mắt đã khiến toàn bộ thần hồn và đạo thể của {B} tan biến.",
  "Khoảng cách giữa {A} và {B} không phải cảnh giới — đó là ranh giới giữa trời và đất.",
  "{B} ngã xuống trước khi {A} bước đến. Không cần đánh — sự tồn tại của {A} là đủ.",

  // Gap >= 4 (annihilation hoàn toàn)
  "{A} thở nhẹ — đạo khí vô tình thoát ra đã đủ để thiêu đốt toàn bộ tinh thần của {B}.",
  "Sự chênh lệch quá lớn khiến việc gọi đây là 'chiến đấu' là một sự xúc phạm với cả hai. {B} tan thành mây khói.",
  "Thiên đạo vô tình. {A} không giết {B} — quy luật vũ trụ đã làm điều đó thay. Kẻ yếu không được phép đứng trước kẻ mạnh.",
];

// Variant: "khinh đan" — kẻ mạnh không thèm lấy đan dược của kẻ yếu.
// Không trừ pills của loser. Có hiệu ứng comedic + sốc.
const ANNIHILATION_TEMPLATES_MOCK_PILL = [
  "{A} nhặt vài viên đan dược cấp thấp từ thi thể đạo thể {B}, lắc đầu rồi vứt đi: 'Mấy loại đan này, ta khinh.'",
  "{A} liếc qua túi trữ vật của {B}: 'Đan dược cấp luyện khí — rẻ tiền, ta không thèm.' Quay lưng đi.",
  "{A} cười nhạt: 'Cứ giữ đan dược của ngươi đi — ta đoạt vài viên kẻ khác không xứng làm bẩn tay.'",
  "{B} tỉnh dậy thấy đan dược vẫn còn nguyên trong túi. Bên cạnh là một mảnh giấy: 'Đan rẻ. Cảnh giới yếu. Đừng tới nữa.' — {A}.",
  "{A} kéo {B} dậy, đập nhẹ vai: 'Đan dược của ngươi ta không nỡ lấy — vì lấy rồi ta thấy nhục.' Bước đi không quay đầu.",
  "{A} nhìn xuống chỗ {B} ngã: 'Ngay cả đan dược độ kiếp của ngươi cũng chưa đáng giá để ta nhúng tay. Lần sau, đi luyện thêm.'",
];

// Pick logic: 50/50 between pure and mock_pill. mock_pill chỉ trigger khi
// gap >= 2 AND defender có ít nhất 1 đan dược (để có gì mà "khinh").
```

> **Quan trọng:** Đơn phương miễu sát **không trừ đan dược của loser**. Đây là cơ chế "narrative-only loss" — flavor cực mạnh nhưng zero penalty với người yếu. Triết lý: kẻ mạnh khinh thường, không buồn lấy. (Khác với duel ngang sức — có thể có stake transfer.)

### 9.3 Output Format

```
══════════════════════════════════════════
⚡ ĐƠN PHƯƠNG MIỄU SÁT ⚡

⚔️  TrùngLong_Tu  [Hóa Thần • Level 52]
         vs
🌱  TânThí_Anh  [Luyện Khí • Level 3]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"TrùngLong_Tu chỉ dùng một ánh mắt đã 
khiến toàn bộ thần hồn và đạo thể của 
TânThí_Anh tan biến."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 Kết quả: TrùngLong_Tu thắng tuyệt đối
⚠️  Lưu ý: Kẻ mạnh không nên ức hiếp yếu.
══════════════════════════════════════════
```

### 9.4 Edge cases

- Gap = 1: Duel bình thường, nhưng hiển thị note nhỏ "Chênh lệch cảnh giới — kết quả có thể hiển nhiên"
- Gap = 0: Duel bình thường
- Defender có 2+ stack legendary pháp khí + công pháp: vẫn là đơn phương miễu sát về mặt lore, nhưng CP check có thể override (design decision — đơn giản nhất là luôn trigger theo gap, không theo CP)

---

## 9.5 Note: Discord text duel sẽ deprecate

Per Bill's decision (2026-05-17): Discord text-based duel (`/duel` simulation trong bot) sẽ bị remove trong tương lai khi Arena Unity (Colyseus) hoàn thiện và stable. Implication:
- Đơn phương miễu sát logic vẫn implement trong bot — vì cần check khi user thử `/arena create` với gap quá lớn → reject + show miễu sát narrative thay vì tạo room
- Pháp khí `stat_bonuses.duel_damage_bonus` áp dụng cho **Arena Unity** (server authoritative), bot chỉ tính + gửi qua API `/api/arena/loadout`
- Render duel-card (mục 12.5) tái dụng cho Arena post-match result thay vì duel cũ

---

## 10. Item Upgrade System — "Cường Hóa"

> Mọi item sở hữu (công pháp, pháp khí, nhẫn) đều có thể **cường hóa** từ level 0 → 10. Mỗi cấp tăng combat power của item đó +10%. No-fail (không lose material), cost tăng theo level.

### 10.1 Schema thêm `level` field

```typescript
export interface UserCongPhap extends Record<string, unknown> {
  id: string;
  discord_id: string;
  cong_phap_slug: string;
  level: number;          // MỚI — 0..10, default 0 khi mua
  acquired_at: number;
}

export interface UserPhapKhi extends Record<string, unknown> {
  // ... + level: number
}

export interface UserNhan extends Record<string, unknown> {
  // ... + level: number
}
```

### 10.2 Effective Combat Power

```typescript
function effectiveCombatPower(baseCp: number, level: number): number {
  return Math.floor(baseCp * (1 + 0.1 * level));
}

// Level 0 = base (100%)
// Level 5 = base × 1.5 (150%)
// Level 10 = base × 2.0 (200%, gấp đôi)
```

### 10.3 Upgrade Cost Formula

```typescript
const RARITY_COST_MULTIPLIER: Record<string, number> = {
  common: 1.0,
  uncommon: 1.3,
  rare: 1.8,
  epic: 3.0,
  legendary: 5.0,
  tien_khi: 8.0,
};

function upgradeCost(currentLevel: number, rarity: string): { pills: number; contribution: number } {
  const mult = RARITY_COST_MULTIPLIER[rarity] ?? 1.0;
  const nextLevel = currentLevel + 1;
  return {
    pills: Math.ceil(nextLevel * mult),
    contribution: Math.ceil(nextLevel * 50 * mult),
  };
}
```

**Ví dụ cost table cho 1 item Epic công pháp:**

| Level | Pills | Contribution | Effective CP (base 500) |
|---|---|---|---|
| 0 → 1 | 3 | 150 | 500 → 550 |
| 1 → 2 | 6 | 300 | 550 → 600 |
| 2 → 3 | 9 | 450 | 600 → 650 |
| 5 → 6 | 18 | 900 | 750 → 800 |
| 9 → 10 | 30 | 1500 | 950 → 1000 |
| **Total 0→10** | **~165 đan** | **~8,250 CP** | **+500 CP gain** |

Legendary item (mult 5.0) total 0→10: ~275 đan + ~13,750 CP. Tier_khi (mult 8.0): ~440 đan + ~22,000 CP. Cường hóa Thái Cực Đồ về max → endgame goal.

### 10.4 No-Fail Policy

Quyết định: **KHÔNG có fail chance**. Lý do:
- Tránh frustration (gacha rage = user churn)
- Cost đã đủ gating (max level cần months activity)
- Pháp môn xianxia về "tu luyện kiên trì" — fail mỗi lần luyện công không phù hợp narrative

### 10.5 UI — Upgrade Flow

#### Entry point 1: `/cuong-hoa` slash command
```
/cuong-hoa list                  → show all owned items + current level + next cost
/cuong-hoa <slug>                → focus on 1 item, full upgrade panel
```

#### Entry point 2: Button trong `/inventory`
Inside Nhẫn Trữ Vật, mỗi owned item có button `[⬆ Cường Hóa]` ngay cạnh.

#### Upgrade Panel UI (Components V2)

```
┌──────────────────────────────────────────────────────┐
│  ⬆️ CƯỜNG HÓA — Thiên Ma Giải Thể                  │
├──────────────────────────────────────────────────────┤
│  👁️  Thiên Ma Giải Thể  [Epic · Thiên Ma]          │
│                                                      │
│  Level hiện tại:  ⭐⭐⭐⭐⭐⭐☆☆☆☆  (6/10)            │
│                                                      │
│  ⚡ Lực Chiến hiện tại:  960  (base 600 × 1.6)      │
│  ⚡ Sau cường hóa:        1020 (+60)                │
│                                                      │
│  CHI PHÍ → Level 7                                  │
│  💊 21 đan dược  +  🏅 1,050 CP                    │
│                                                      │
│  Số dư của ngươi:                                   │
│  💊 45 đan / 🏅 3,200 CP  → ✅ Đủ                  │
├──────────────────────────────────────────────────────┤
│  [⬆ Cường Hóa Lên Level 7]  [📊 Xem Bảng Cost]    │
│  [❌ Đóng]                                          │
└──────────────────────────────────────────────────────┘
```

#### Cost Table Modal (khi click "Xem Bảng Cost")
Render canvas card showing full L0→L10 cost trajectory với progress bar visual.

#### Cường hóa thành công → VFX
- Khi level lên → post short GIF (cached, generic per rarity, không cần per item):
  - Common/uncommon: 1s flash gradient màu rarity
  - Rare/epic: 2s expand glow ring + sparkle particles
  - Legendary: 3s full screen flash + sound emoji "✦ ✦ ✦" cascade
  - Tien_khi (max level only): rainbow sweep + "ĐẠI THÀNH" text overlay
- Reuse `item-reveal.ts` module, parametrize bằng rarity color

### 10.6 Storage Operations

```typescript
// src/modules/combat/upgrade.ts
export async function upgradeItem(
  discordId: string,
  itemType: 'cong_phap' | 'phap_khi' | 'nhan',
  slug: string,
): Promise<UpgradeResult> {
  const user = store.users.get(discordId);
  const ownership = findOwnership(itemType, discordId, slug);
  if (!ownership) return { ok: false, reason: 'not_owned' };
  if (ownership.level >= 10) return { ok: false, reason: 'max_level' };

  const catalogItem = getCatalogItem(itemType, slug);
  const cost = upgradeCost(ownership.level, catalogItem.rarity);

  if ((user.pills ?? 0) < cost.pills) return { ok: false, reason: 'not_enough_pills' };
  if ((user.contribution_points ?? 0) < cost.contribution) return { ok: false, reason: 'not_enough_cp' };

  // Atomic: deduct cost + bump level. Both writes in same store mutex.
  await store.users.set({
    ...user,
    pills: (user.pills ?? 0) - cost.pills,
    contribution_points: (user.contribution_points ?? 0) - cost.contribution,
  });
  await updateOwnership(itemType, ownership.id, { ...ownership, level: ownership.level + 1 });

  return { ok: true, newLevel: ownership.level + 1 };
}
```

---

## 11. Quest Item Drop System

> Daily quest và sự kiện đặc biệt có thể drop item ngẫu nhiên — không chỉ XP/đan/CP.

### 11.1 Schema mở rộng DailyQuest

```typescript
export interface QuestItemDrop {
  item_type: 'cong_phap' | 'phap_khi' | 'nhan';
  slug: string;
  probability: number;  // 0..1, rolled khi quest hoàn thành
}

export interface DailyQuest extends Record<string, unknown> {
  // ... existing fields ...
  reward_item_pool?: QuestItemDrop[] | null;  // MỚI — tối đa 3 drop entries
}
```

### 11.2 Drop Pool Design

| Quest tier | XP | Pills | CP | Item drop pool |
|---|---|---|---|---|
| Daily — Easy (message 30 cái) | 50 | 1 | 30 | 5% common nhẫn |
| Daily — Medium (voice 30min) | 80 | 2 | 60 | 10% uncommon nhẫn / 3% common công pháp |
| Daily — Hard (5 reactions) | 100 | 3 | 100 | 15% rare nhẫn / 5% rare công pháp |
| Weekly | 500 | 10 | 500 | 50% epic ring / 20% epic công pháp / 5% legendary nhẫn |
| Tribulation Pass | 1000 | 20 | 1000 | 100% guaranteed epic+ random item |
| Event (mod-triggered) | varies | varies | varies | Guaranteed legendary + rare extra roll |

### 11.3 Roll Logic

```typescript
function rollQuestDrop(pool: QuestItemDrop[], rng: () => number): QuestItemDrop | null {
  // Independent rolls — multiple drops possible.
  // Sort highest probability first (cosmetic — order shouldn't matter logically).
  for (const entry of pool) {
    if (rng() < entry.probability) return entry;
  }
  return null;
}
```

> **Anti-stacking**: Nếu user đã sở hữu item drop được → roll lại 1 lần với pool khác. Nếu vẫn fail → convert thành đan dược (5 đan cho rare, 15 cho epic, 50 cho legendary). Đảm bảo drop never wasted.

### 11.4 UI — Drop Reveal

Khi quest hoàn thành + roll trúng drop:
1. Post quest reward embed bình thường (XP/pills/CP)
2. **Followup** message → attach pre-rendered item-reveal GIF (cùng module mục 12.6):
   ```
   ✦ THIÊN GIÁNG BẢO VẬT ✦
   [GIF item reveal animation]
   Ngươi đã nhận: 💍 Thiên Tinh Sa Nhẫn [Epic]
   "Trâm ngọc bích — nhỏ như sợi chỉ..."
   [📜 Xem chi tiết]  [🔮 Trang bị ngay]
   ```

### 11.5 Quest Generator Update

`src/modules/quests/generator.ts` (existing — needs update):
- Khi assign daily quest → cũng populate `reward_item_pool` dựa trên tier
- Tier auto-determine từ user rank: pham_nhan/luyen_khi → easy pool; trúc_co+ → medium; nguyên_anh+ → hard

---

## 12. Combat Power Formula Update

```typescript
// V2 formula — incorporates upgrade level on each equipment piece.
combat_power =
  BASE (100)
  + level × 10
  + rank_index × 50
  + (sub_title ? 50 : 0)
  + effectiveCP(equipped_cong_phap.base_cp, equipped_cong_phap.upgrade_level)
  + effectiveCP(equipped_phap_khi.base_cp, equipped_phap_khi.upgrade_level)
  + sum(equipped_rings.map(r => effectiveCP(r.base_cp, r.upgrade_level)))

// effectiveCP(baseCp, level) = floor(baseCp × (1 + 0.1 × level))
// XP multiplier from all sources capped at +30% total (anti-stack).
```

---

## 13. VFX & Visual Rendering Layer (Full Visual mode)

> Quyết định: **Full visual** — canvas procedural + GIF procedural + Components V2.  
> Asset: **100% code-generated**, không cần file PNG/GIF từ bên ngoài.

### 13.1 Tech Stack (thêm)

| Lib | Mục đích | Note |
|---|---|---|
| `canvas@3.1.0` | Đã có (captcha) — reuse cho rank card, duel card | OK |
| `gifenc` | Encode frame array → animated GIF, pure JS, nhanh | Thêm dep |
| `discord.js@14.16.3` | Đã có — support Components V2 (Container/Section/etc.) | OK |

### 13.2 Render Modules

```
src/modules/render/
├── palette.ts          # Color tokens per rank (gradient stops, glow color)
├── primitives.ts       # Low-level: radial gradient, blur, particle dots, glow ring
├── profile-card.ts     # composeProfileCard(user) → PNG buffer
├── duel-card.ts        # composeDuelCard(challenger, defender, result) → PNG buffer
├── item-showcase.ts    # composeItemReveal(item, rarity) → GIF buffer (for legendary pull)
├── aura-gif.ts         # composeRankAuraGif(rank) → GIF buffer (cached by rank)
├── cache.ts            # Hash-keyed cache: rank+version → Buffer, on-disk persist
└── index.ts            # public API
```

### 13.3 Procedural Aura GIF — per rank

Algorithm:
1. Frame size: 256×256, 24 frames, 12 FPS → 2 sec loop
2. Per frame:
   - Background: transparent
   - Layer 1 (outer ring): radial gradient từ `rankColor` (alpha 0.6) tiến ra alpha 0
   - Layer 2 (particles): N particle dots quay quanh tâm với `angle = baseAngle + frame * speed`
   - Layer 3 (inner glow): radial gradient từ tâm với `rankColor` brighter
   - Layer 4 (rank-specific FX):
     - Phàm Nhân: không có (gray gradient nhẹ)
     - Luyện Khí: 3 droplet xanh xoay
     - Trúc Cơ: leaf-shape particles
     - Kim Đan: 5 vàng kim sparkle, mỗi 4 frame chớp
     - Nguyên Anh: tím rotation + bigger center orb
     - Hóa Thần: flame tongues (Perlin noise distortion) đỏ-cam
     - Luyện Hư: moonlight white-green crescent rotation
     - Hợp Thể: hồng-vàng dual aura
     - Đại Thừa: white cloud trails
     - Độ Kiếp: lightning bolts random spawn 1 frame
     - Tiên Nhân: rainbow gradient sweep
3. Encode 24 frames → GIF bằng `gifenc`
4. **Cache**: render lần đầu cho mỗi rank → save `data/cache/render/aura-{rank_id}-v1.gif` → đọc cached lần sau

```typescript
// src/modules/render/aura-gif.ts
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { createCanvas } from 'canvas';
import type { CultivationRankId } from '@/db/types';

interface AuraConfig {
  baseColor: string;
  particleCount: number;
  particleType: 'dot' | 'leaf' | 'sparkle' | 'flame' | 'crescent' | 'bolt';
  rotationSpeed: number;
  fxLayer?: (ctx: CanvasRenderingContext2D, frame: number) => void;
}

const AURA_CONFIGS: Record<CultivationRankId, AuraConfig> = {
  pham_nhan: { baseColor: '#95989e', particleCount: 0, particleType: 'dot', rotationSpeed: 0 },
  luyen_khi: { baseColor: '#b8c5d0', particleCount: 3, particleType: 'dot', rotationSpeed: 0.05 },
  truc_co:   { baseColor: '#7fa6c5', particleCount: 5, particleType: 'leaf', rotationSpeed: 0.08 },
  kim_dan:   { baseColor: '#e6c87e', particleCount: 5, particleType: 'sparkle', rotationSpeed: 0.1 },
  nguyen_anh:{ baseColor: '#b09bd3', particleCount: 6, particleType: 'dot', rotationSpeed: 0.12 },
  hoa_than:  { baseColor: '#d97b8a', particleCount: 8, particleType: 'flame', rotationSpeed: 0.15 },
  luyen_hu:  { baseColor: '#8fbf9f', particleCount: 4, particleType: 'crescent', rotationSpeed: 0.06 },
  hop_the:   { baseColor: '#d4a574', particleCount: 7, particleType: 'sparkle', rotationSpeed: 0.1 },
  dai_thua:  { baseColor: '#e8eaf0', particleCount: 6, particleType: 'dot', rotationSpeed: 0.05 },
  do_kiep:   { baseColor: '#ffd56b', particleCount: 3, particleType: 'bolt', rotationSpeed: 0.2 },
  tien_nhan: { baseColor: '#f5e8ff', particleCount: 10, particleType: 'sparkle', rotationSpeed: 0.08 },
};

export async function composeRankAuraGif(rank: CultivationRankId): Promise<Buffer> {
  const cached = await cache.read(`aura-${rank}-v1.gif`);
  if (cached) return cached;

  const config = AURA_CONFIGS[rank];
  const SIZE = 256;
  const FRAMES = 24;
  const FPS = 12;

  const enc = GIFEncoder();
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  for (let f = 0; f < FRAMES; f++) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawOuterRing(ctx, SIZE, config.baseColor);
    drawParticles(ctx, SIZE, f, config);
    drawInnerGlow(ctx, SIZE, config.baseColor);
    if (config.fxLayer) config.fxLayer(ctx, f);

    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const palette = quantize(data, 256);
    const indexed = applyPalette(data, palette);
    enc.writeFrame(indexed, SIZE, SIZE, { palette, delay: 1000 / FPS, transparent: true });
  }
  enc.finish();
  const buf = Buffer.from(enc.bytes());
  await cache.write(`aura-${rank}-v1.gif`, buf);
  return buf;
}
```

### 13.4 Procedural Profile Card

Output: PNG 1000×500 (tỷ lệ chuẩn rank card)

Layout:
```
┌─────────────────────────────────────────────────────────────────┐
│  [aura glow bg gradient theo rank]                              │
│                                                                 │
│  ╔════════╗   👤 TrùngLong_Tu                                 │
│  ║ AVATAR ║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│  ║ + glow ║   🔥 HÓA THẦN · Level 55                         │
│  ║  ring  ║   ⚡ Lực Chiến: 2,840                           │
│  ╚════════╝   ▓▓▓▓▓▓▓▓▓░░░ XP 128,450 / 145,000           │
│                                                                 │
│  ┌──────┬──────┬──────┬──────┐                                │
│  │  📚  │  🔮  │  💍  │  💍  │   ← slot row                   │
│  │ Thiên│ Hỗn  │ Lôi  │      │                                │
│  │  Ma  │ Độn  │ Quang│      │                                │
│  └──────┴──────┴──────┴──────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

Render steps (`composeProfileCard`):
1. **Background**: Vertical gradient từ `rankColor` (top, alpha 0.4) → black (bottom)
2. **Aura ring**: Vẽ vòng radial gradient quanh vị trí avatar (`ctx.createRadialGradient`)
3. **Avatar**: Fetch from `user.displayAvatarURL({ size: 256 })`, clip circular, paste với offset
4. **Glow stroke**: Vẽ vòng tròn `strokeStyle = rankColor + 'CC'`, `shadowBlur = 30`, `shadowColor = rankColor`
5. **Text layer**:
   - Username: bold 36px Inter/Noto Sans, color white
   - Rank line: rank emoji + name, color = rankColor
   - Stats: monospace 24px
6. **XP bar**: rounded rect base (gray) + filled rect (gradient `rankColor` → lighter), text overlay
7. **Slot row**: 4 ô 96×96 với rounded border, color theo rarity (common=gray, rare=blue, epic=purple, legendary=gold), Unicode emoji icon vẽ ở giữa
8. Output `canvas.toBuffer('image/png')`

**Procedural avatar glow** (no GIF, static):
```typescript
function drawAvatarGlow(ctx, cx, cy, radius, color) {
  // Outer glow
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * 1.5);
  gradient.addColorStop(0, color + 'AA');
  gradient.addColorStop(1, color + '00');
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);

  // Inner ring
  ctx.shadowBlur = 20;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}
```

### 13.5 Procedural Duel Card

Output: PNG 1200×600

Layout:
```
┌──────────────────────────────────────────────────────────────────┐
│                    ⚔️ ĐẤU PHÁP ⚔️                                │
│  ────────────────────────────────────────────────────────────    │
│                                                                  │
│  [AVATAR A]              VS              [AVATAR B]              │
│  TrùngLong_Tu                                TânThí_Anh         │
│  🔥 Hóa Thần Lv55                            🌱 Luyện Khí Lv3  │
│  ⚡ 2,840                                     ⚡ 180             │
│  ❤️ ████████░░ 800/1000                       ❤️ ░░░░░░░ 0/200 │
│                                                                  │
│  ────────────────────────────────────────────────────────────    │
│         🏆 TrùngLong_Tu thắng — Đơn Phương Miễu Sát            │
└──────────────────────────────────────────────────────────────────┘
```

Cho **Đơn Phương Miễu Sát**: render avatar A có aura mạnh (intense glow), avatar B mờ đi (alpha 0.3 + ash particles overlay).

### 13.6 Legendary Pull / Upgrade Reveal GIF

Khi user mua item legendary, trước khi confirm purchase → preview animation:

Frames sequence (30 frames @ 15 FPS = 2 sec):
- 0-5: black BG, fading glow tâm
- 6-15: glow expand, particle burst outward
- 16-22: item icon (emoji) fade in từ center, scale 0 → 1.2 → 1.0
- 23-29: rarity text "✦ LEGENDARY ✦" fade in below, sparkle particles loop

Cache: vì lore phụ thuộc item, cache theo `{slug}-pull-v1.gif`. Pre-generate sẵn cho 10+ legendary items.

### 13.7 Components V2 Layout — Shop Refactor

```typescript
// src/commands/shop.ts (V2 layout sketch)
import { ContainerBuilder, SectionBuilder, SeparatorBuilder, TextDisplayBuilder } from 'discord.js';

const container = new ContainerBuilder()
  .setAccentColor(rankColorHex)
  .addTextDisplayComponents(
    td => td.setContent('# 🏪 Thiên Bảo Các\n💊 15 đan · 🏅 320 CP')
  )
  .addSeparatorComponents(new SeparatorBuilder())
  .addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        td => td.setContent('### 🌀 Nguyên Anh Tâm Pháp `Epic`\nTu luyện Nguyên Anh — đạo tâm bất hoại.\n💊 8 · 🏅 1200 · ⚡ +500')
      )
      .setButtonAccessory(
        btn => btn.setCustomId('shop:buy:nguyen-anh-tam-phap').setLabel('Mua').setStyle(ButtonStyle.Success)
      )
  )
  // ... more SectionBuilder cho từng item
  ;

await interaction.reply({
  components: [container],
  flags: MessageFlags.IsComponentsV2,  // bắt buộc cho V2
});
```

**Lưu ý quan trọng:** Khi dùng `IsComponentsV2`, **không được set `embeds` hoặc `content` cùng lúc** — tất cả phải qua components.

### 13.8 Performance & Cache

| Render | Cost lần đầu | Cost cached | Cache key |
|---|---|---|---|
| Aura GIF | ~800ms | ~5ms read | `aura-{rank}-v1.gif` |
| Profile card | ~150ms | — (không cache, dữ liệu thay đổi) | — |
| Duel card | ~200ms | — | — |
| Legendary pull GIF | ~1.2s | ~5ms read | `pull-{slug}-v1.gif` |

Cache directory: `data/cache/render/` (gitignore, regenerate on first call).  
Eviction: không cần — dataset nhỏ (~15 GIF tổng cộng, ~5MB). Bump `-v2` suffix khi đổi formula → cache cũ orphan.

### 13.9 Memory & Concurrency

- Mỗi canvas alloc ~1MB (1000×500 RGBA buffer) → GC sau khi `toBuffer`
- Concurrent render: dùng `async-mutex` để giới hạn 2 render song song (tránh OOM với spike traffic)
- Render timeout 5s — nếu lâu hơn → log error + fallback embed text

```typescript
import { Mutex } from 'async-mutex';
const renderLock = new Mutex();  // limit concurrent canvas ops

export async function safeRender<T>(fn: () => Promise<T>): Promise<T> {
  return renderLock.runExclusive(fn);
}
```

---

## 14. Implementation Roadmap (Updated với Upgrade + Quest Drop + VFX)

> 7 lát thay vì 4 — chia nhỏ để mỗi lát ship được độc lập, có thể test + commit riêng.

### Lát D.3 — Schema + Data Foundation (~5h)
- [ ] Update `src/db/types.ts`: thêm `PhapKhi`, `UserPhapKhi`, `Nhan`, `UserNhan`, `QuestItemDrop`
- [ ] Mở rộng `CongPhap`: thêm `icon`, `school`, `lore`, `passive_text`
- [ ] Thêm field `level: number` vào `UserCongPhap`, `UserPhapKhi`, `UserNhan` (default 0)
- [ ] Thêm field `reward_item_pool` vào `DailyQuest`
- [ ] Update `src/db/store.ts`: thêm 4 collection mới (`phapKhiCatalog`, `userPhapKhi`, `nhanCatalog`, `userNhan`)
- [ ] Update `User` interface: thêm `equipped_phap_khi_slug`, `equipped_ring_slugs`
- [ ] Viết `phap-khi-catalog.json` (10 items với lore đầy đủ)
- [ ] Viết `nhan-catalog.json` (8 items)
- [ ] Cập nhật `cong-phap-catalog.json` — thêm 15 items mới + icon + school + lore + passive_text cho tất cả
- [ ] Viết catalog loaders cho pháp khí và nhẫn (zod schema validation)
- [ ] Snapshot migration test: load snapshot v1 (no new fields) → check default values applied

### Lát D.4 — Business Logic Core (~4h)
- [ ] `src/modules/combat/phap-khi.ts`: buy / equip / unequip / list / info
- [ ] `src/modules/combat/nhan.ts`: buy / equip (max 2 slot) / unequip / list / info
- [ ] `src/modules/combat/upgrade.ts`: upgradeItem() — atomic deduct + level bump (mục 10.6)
- [ ] `src/modules/combat/upgrade-cost.ts`: cost formula by rarity + current level (pure)
- [ ] Update `src/modules/combat/power.ts`: V2 formula với upgrade level + ring sum + XP cap 30%
- [ ] Update `src/modules/combat/duel.ts`: đơn phương miễu sát gap check (vẫn giữ tạm cho Discord, sẽ relocate khi remove duel)
- [ ] `src/modules/combat/annihilation.ts`: narration template picker (pure + mock_pill variants)
- [ ] `src/modules/quests/drop-roller.ts`: rollQuestDrop() (mục 11.3) + anti-stacking convert-to-pills logic
- [ ] Unit tests cho từng module trên — đặc biệt upgrade cost formula + drop probability distribution

### Lát D.5 — Render Layer Foundation (~6h)
- [ ] `npm i gifenc`, update package.json + lockfile
- [ ] `src/modules/render/palette.ts` — color tokens cho 11 rank
- [ ] `src/modules/render/primitives.ts` — drawGradient, drawGlowRing, drawParticles, drawRoundedRect, drawTextWithShadow
- [ ] `src/modules/render/cache.ts` — disk-backed cache layer (read/write Buffer, version key)
- [ ] `src/modules/render/safe-render.ts` — `async-mutex` wrapper, timeout 5s, fallback handler
- [ ] `src/modules/render/aura-gif.ts` — 11 rank aura GIF generators với rank-specific FX layers
- [ ] Unit smoke test: render each aura → confirm valid GIF magic bytes + size < 200KB

### Lát D.6 — Render Profile + Duel + Item-Reveal (~6h)
- [ ] `src/modules/render/profile-card.ts` — composeProfileCard(user) với avatar fetch + circular clip + glow ring + 4-slot grid
- [ ] `src/modules/render/duel-card.ts` — composeDuelCard với 2 variants: normal duel, annihilation (loser fade + ash)
- [ ] `src/modules/render/item-reveal.ts` — composeItemReveal(item, rarity, reason: 'pull' | 'drop' | 'upgrade')
- [ ] `scripts/warmup-render-cache.ts` — pre-generate 11 aura + 10 legendary pull GIF on deploy
- [ ] Integration test: render profile card cho fake user mỗi rank → manual visual review

### Lát D.7 — Commands + Components V2 UI (~7h)
- [ ] Refactor `src/commands/shop.ts` dùng **Components V2** ContainerBuilder + SectionBuilder + button accessory
- [ ] Shop pagination: `[◀ Trang trước]` `[Trang X/Y]` `[Trang sau ▶]` buttons
- [ ] Shop tabs: select menu cho `[📚 Công Pháp]` `[🔮 Pháp Khí]` `[💍 Nhẫn]`
- [ ] Refactor `src/commands/profile.ts` — attach profile card PNG làm `embed.image` + aura GIF làm thumbnail
- [ ] Refactor `src/commands/inventory.ts` — "Nhẫn Trữ Vật" với Components V2 (sections cho 4 equipped slots + sections cho owned items)
- [ ] Thêm button `[⬆ Cường Hóa]` cạnh mỗi item trong inventory
- [ ] Thêm `src/commands/cuong-hoa.ts` — slash command + upgrade panel UI
- [ ] Update `src/commands/cong-phap.ts` — full lore display + school filter
- [ ] Thêm `src/commands/phap-khi.ts` — list / info / buy / equip / unequip
- [ ] Thêm `src/commands/nhan.ts` — list / info / buy / equip (max 2) / unequip
- [ ] Update `src/commands/quest.ts` — show drop pool preview + reveal animation khi roll trúng
- [ ] Update `src/commands/arena.ts`: pre-check gap >= 2 → reject + show miễu sát narrative thay vì tạo room

### Lát D.8 — Polish + Tests + Docs (~3h)
- [ ] Unit tests CP formula V2 với upgrade level edge cases (lv 0, 5, 10)
- [ ] Unit tests đơn phương miễu sát trigger boundary (gap 1, 2, 3)
- [ ] Unit tests upgrade cost formula across all rarities
- [ ] Unit tests quest drop probability — Monte Carlo 10k rolls per pool, verify expected distribution ±5%
- [ ] Snapshot test cho render output (hash compare, allow alpha tolerance)
- [ ] Smoke test full shop flow: browse → detail → buy → equip → upgrade → reveal animation
- [ ] Update PROGRESS.md → Phase 14 (V2 Visual + Items)
- [ ] Update SPEC.md với new entity types
- [ ] Update CLAUDE.md — note Components V2 usage pattern + render layer

**Tổng effort: ~31h** chia 6 lát (D.3 → D.8). Mỗi lát ship được độc lập, không phụ thuộc lát sau ngoại trừ:
- D.4 cần D.3 (schema)
- D.6 cần D.5 (primitives)
- D.7 cần D.4 + D.6 (logic + render assets)

**Critical path (sequential):** D.3 → D.4 → D.7  
**Parallel opportunities:** D.5+D.6 (render layer) chạy song song với D.4 (business logic) sau khi D.3 xong.

---

## 15. Status — Decisions Locked (2026-05-17)

All major design questions are answered. Below is the locked spec for kickoff.

| Decision | Answer |
|---|---|
| Nhẫn source | Shop **+** quest drop (mục 11 — pool by tier) |
| XP multiplier cap | **+30% total** (combined across công pháp + pháp khí + nhẫn) |
| Pháp khí stat scope | Áp dụng **Arena Unity** (Discord text duel sẽ deprecate per mục 9.5) |
| Đơn phương miễu sát penalty | **None** — narrative only. Templates "khinh đan" trong mục 9.2 |
| Shop pagination | **Buttons** (◀ Trang trước · Trang sau ▶) |
| `gifenc` install | **Yes, install** — render 1 lần per rank + cache disk |
| Upgrade system | **Yes**, no-fail, 0→10, formula mục 10.3 |
| Quest item drop | **Yes**, probability pool by quest tier (mục 11.2) |
| Item-reveal GIF | Reuse cho cả pull mua, quest drop, upgrade success (mục 13.6) |
| Render asset source | 100% procedural canvas + gifenc, no external files |

### Open follow-ups (low priority, có thể decide khi code)

1. **Upgrade material**: hiện tại dùng đan + CP. Có muốn introduce 1 currency riêng "Linh Thạch" để cường hóa không? — đề xuất: **không**, giữ economy đơn giản với 2 currency hiện tại.
2. **Item-reveal GIF size**: 256×256 hay 384×384? — đề xuất: 256×256 (Discord embed image fit tốt, render nhanh).
3. **Max owned của 1 item**: Cho phép user mua duplicate cùng 1 công pháp/pháp khí không? — đề xuất: **không** (duplicate → refund 50% CP), giữ inventory clean.
4. **Anti-stacking nhẫn**: Đeo 2 nhẫn giống hệt slug → block hay cho phép double bonus? — đề xuất: **block**, mỗi slug max 1 instance equipped.

1. **Nhẫn**: Có muốn nhẫn cũng có thể lấy từ quest/event không, hay chỉ mua shop?
2. **XP multiplier từ công pháp**: Cần cap ở mức nào? (đề xuất tối đa +30% combined từ tất cả equipment)
3. **Duel với pháp khí bonus damage**: Arena (Colyseus game) và Discord text duel có dùng cùng formula không?
4. **Profile canvas**: Muốn làm rank badge overlay bằng `node-canvas` ngay trong phase này không, hay text-emoji trước?
5. **Đơn phương miễu sát**: Có trừ đan dược của kẻ thua không? Hay chỉ narrative không penalty?
6. **Shop pagination**: Với 27 công pháp, cần pagination — dùng button "Trang 2 ▶" hay Select Menu với page options?
