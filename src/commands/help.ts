import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

/**
 * /help — grouped command reference. With ~25 slash commands across
 * leveling, game mechanics, Aki NPCs, admin tools, and verification,
 * users were getting lost. This consolidates all commands into one
 * ephemeral embed with section headers.
 */

interface CommandRow {
  name: string;
  desc: string;
  staff?: boolean;
}

const SECTIONS: ReadonlyArray<{
  title: string;
  emoji: string;
  rows: CommandRow[];
}> = [
  {
    title: 'Tu vi / Leveling',
    emoji: '📈',
    rows: [
      { name: '/rank [user?]', desc: 'Xem cảnh giới + XP + currency + progress' },
      { name: '/stat [user?]', desc: 'Profile combat: lực chiến + breakdown + công pháp' },
      { name: '/leaderboard [period?] [mode?]', desc: 'Top 10 theo XP hoặc lực chiến' },
      { name: '/daily', desc: 'Điểm danh hằng ngày — 100 XP + streak bonus + đan dược/cống hiến' },
      { name: '/breakthrough', desc: 'Khởi Thiên Kiếp (cần Lv 10 + 1 đan dược, cooldown 24h)' },
      {
        name: '/title add|remove|list',
        desc: 'Sub-title (Kiếm Tu / Đan Sư / Trận Pháp Sư / Tán Tu)',
      },
      { name: '/quest', desc: 'Nhiệm vụ hằng ngày + tiến độ (auto reset 00:00 VN)' },
    ],
  },
  {
    title: 'Game mechanics / Phase 12',
    emoji: '⚔️',
    rows: [
      { name: '/inventory', desc: 'Túi đồ: đan dược + cống hiến + công pháp đang sở hữu' },
      { name: '/shop', desc: 'Catalog công pháp lọc theo cảnh giới' },
      {
        name: '/cong-phap list|info|buy|equip|unequip',
        desc: 'CRUD công pháp: xem chi tiết, mua, trang bị, gỡ',
      },
      {
        name: '/trade sell <slug>',
        desc: 'Bán lại công pháp (refund 50-100%, 10% chance Aki mua full)',
      },
      { name: '/duel @opponent [stake?]', desc: 'PvP 5 hiệp với accept window 60s' },
    ],
  },
  {
    title: 'Aki AI',
    emoji: '🤖',
    rows: [
      { name: '/ask <question> [image?]', desc: 'Hỏi Aki — hầu gái mặc định (sass + helpful)' },
      { name: '/ask-akira <question>', desc: 'Hỏi Akira — học giả formal (tone kiên nhẫn)' },
      { name: '/ask-meifeng <question>', desc: 'Hỏi Meifeng — kiếm sĩ combat-focused (sass cao)' },
      {
        name: '/aki-memory toggle',
        desc: 'Bật/tắt cho Aki nhớ 3 câu hỏi gần đây của bạn (opt-in)',
      },
    ],
  },
  {
    title: 'Verify',
    emoji: '🔐',
    rows: [{ name: '/verify-test', desc: 'Test captcha flow trên chính bạn (dev/QA)' }],
  },
  {
    title: 'Admin tools',
    emoji: '🛡️',
    rows: [
      { name: '/stats', desc: 'Dashboard 24h: member, top XP, automod, Aki cost', staff: true },
      { name: '/automod-config', desc: 'Xem cấu hình automod hiện tại', staff: true },
      {
        name: '/link-whitelist add|remove|list',
        desc: 'Quản lý whitelist domain runtime',
        staff: true,
      },
      {
        name: '/grant currency:pills|contribution user:@x amount:n',
        desc: 'Cấp currency cho đệ tử (hoặc trừ với amount âm)',
        staff: true,
      },
      {
        name: '/raid-mode on|off',
        desc: 'Bật/tắt raid mode (hard captcha cho mọi join)',
        staff: true,
      },
      {
        name: '/thien-dao target:@user crime:<text>',
        desc: 'Triệu hồi Thiên Đạo xử phạt đệ tử (CHỈ Chưởng Môn — Aki/LLM tự chọn hình phạt). Aki cũng tự gọi Thiên Đạo nếu ai chửi em ấy trong chat (cooldown 1h/user).',
        staff: true,
      },
      {
        name: '/contribute-doc <title> <body> [section?]',
        desc: 'Submit document contribution — Aki tự duyệt + tag (Lát 9)',
      },
    ],
  },
];

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Liệt kê tất cả slash command + mô tả ngắn')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sections = SECTIONS.map((sec) => {
    const lines = sec.rows.map((r) => `• \`${r.name}\`${r.staff ? ' 🛡️' : ''} — ${r.desc}`);
    return `**${sec.emoji} ${sec.title}**\n${lines.join('\n')}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xb09bd3)
    .setTitle('🌸 Radiant Tech Sect — Command Reference')
    .setDescription(sections.join('\n\n').slice(0, 4000))
    .setFooter({
      text: '🛡️ = admin-only · Đọc /rules pinned message cho server etiquette',
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
