# Role icon assets

Drop PNGs here matching the filenames in `src/config/role-icons.ts`
(e.g. `pham_nhan.png`, `luyen_khi.png`, ...).

## Spec

- **Format:** PNG with transparent background
- **Size:** 256×256 px (Discord crops to circle)
- **Motif:** "Quả cầu năng lượng" (energy orb) — glowing sphere, same
  shape across all 10 cultivation ranks; only the tint changes.
- **Tinting:** match the rank's `colorHex` in `src/config/cultivation.ts`.
  Examples:
  - Phàm Nhân: `#8a8a8a` dim grey
  - Luyện Khí: `#a0a0a0` light grey
  - Trúc Cơ: `#5dade2` blue
  - Kim Đan: `#f4d03f` gold
  - Nguyên Anh: `#9b59b6` purple
  - Hoá Thần: `#e74c3c` red
  - Luyện Hư: `#1abc9c` teal-green
  - Hợp Thể: `#e67e22` orange
  - Đại Thừa: `#ecf0f1` white
  - Độ Kiếp: `#ffd700` brilliant gold (most intense)
  - Tiên Nhân: `#ffffff` luminous white (admin-grant)

## Sub-title icons (optional)

Same spec applies but motif can differ per sub-title:

- `kiem_tu.png` — sword
- `dan_su.png` — alchemy flask
- `tran_phap_su.png` — formation glyph
- `tan_tu.png` — wanderer's whirl

## Applying

After dropping the PNGs:

```powershell
# Preview without applying:
npm run bot -- upload-role-icons --use=png --dry-run

# Apply:
npm run bot -- upload-role-icons --use=png
```

Requires **Server Boost Level 2** (≥ 7 boosts). The CLI checks
`guild.premiumTier` and aborts gracefully if not met.

## Fallback (no PNGs / no Boost L2 yet)

Until the icons are designed + boost level reached, the CLI can apply
unicode-emoji icons (still needs Boost L2 per Discord). Run:

```powershell
npm run bot -- upload-role-icons --use=unicode
```

The unicode mapping is in `src/config/role-icons.ts` — eyeballed to
roughly match each rank's color/theme. Swap to PNG mode whenever
designs land.
