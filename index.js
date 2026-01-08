// ============================================
// 📦 استيراد المكتبات المطلوبة
// ============================================
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    ActivityType
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

// ============================================
// ⚙️ إعدادات التكوين
// ============================================
const CONFIG = {
    COLORS: {
        PRIMARY: 0x5865F2,
        SUCCESS: 0x57F287,
        WARNING: 0xFEE75C,
        ERROR: 0xED4245,
        INFO: 0x3498DB
    },
    AI: {
        ENABLED: true,
        MAX_RESPONSE_LENGTH: 1500,
        RESPONSE_DELAY: 2000
    },
    DB_PATH: './tickets_database.db',
    CHANNELS: {
        DEFAULT_CATEGORY_NAME: '🎫 التذاكر',
        LOGS_CHANNEL_NAME: '📁 سجلات-التذاكر'
    }
};

// ============================================
// 🤖 تهيئة العميل
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    presence: {
        activities: [{
            name: '🎫 نظام التذاكر',
            type: ActivityType.Watching
        }]
    }
});

// ============================================
// 🗄️ تهيئة قاعدة البيانات
// ============================================
class DatabaseManager {
    constructor() {
        this.db = new sqlite3.Database(CONFIG.DB_PATH);
        this.initDatabase();
    }

    initDatabase() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                ticket_category_id TEXT,
                logs_channel_id TEXT,
                ai_enabled INTEGER DEFAULT 1,
                ticket_counter INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS support_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT,
                role_id TEXT,
                role_name TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, role_id)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT UNIQUE,
                channel_id TEXT UNIQUE,
                guild_id TEXT,
                user_id TEXT,
                user_tag TEXT,
                reason TEXT,
                status TEXT DEFAULT 'open',
                claimed_by TEXT,
                claimed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                closed_at DATETIME,
                transcript TEXT
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS user_stats (
                user_id TEXT,
                guild_id TEXT,
                tickets_opened INTEGER DEFAULT 0,
                tickets_closed INTEGER DEFAULT 0,
                last_ticket_at DATETIME,
                PRIMARY KEY (user_id, guild_id)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS chat_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT,
                user_id TEXT,
                user_tag TEXT,
                message TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_support INTEGER DEFAULT 0
            )
        `);
    }

    query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

const db = new DatabaseManager();

// ============================================
// 🧠 محرك الذكاء الاصطناعي
// ============================================
class AIAssistant {
    constructor() {
        this.isEnabled = CONFIG.AI.ENABLED;
        this.conversations = new Map();
    }

    async generateResponse(message, context) {
        if (!this.isEnabled) return null;

        await new Promise(resolve => setTimeout(resolve, CONFIG.AI.RESPONSE_DELAY));

        const lowerMessage = message.toLowerCase();
        const responses = {
            'لا استطيع الدخول': 'حاول مسح ذاكرة التخزين المؤقت للمتصفح أو إعادة تثبيت التطبيق.',
            'تطبيق لا يعمل': 'جرب إعادة تشغيل التطبيق أو تحديثه إلى آخر نسخة.',
            'مشكلة في الصوت': 'تحقق من إعدادات الصوت في جهازك ومن صلاحيات الميكروفون.',
            'انقطاع اتصال': 'تحقق من اتصالك بالإنترنت وجرب إعادة تشغيل الراوتر.',
            'مرحبا': 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟',
            'شكرا': 'العفو! 😊 سعيد لأنني استطعت المساعدة.',
            'اقتراح': 'شكراً لاقتراحك! سأنقله لفريق التطوير للنظر فيه.',
            'ميزة جديدة': 'فكرة رائعة! سنأخذها بعين الاعتبار للتحديثات القادمة.',
            'بلاغ': 'شكراً للإبلاغ. سيقوم فريق الإدارة بالتحقق من الأمر.',
            'مشكلة مع عضو': 'سأقوم بإبلاغ فريق الإدارة للتعامل مع الموقف.'
        };

        for (const [keyword, response] of Object.entries(responses)) {
            if (lowerMessage.includes(keyword)) {
                return this.formatResponse(response, context);
            }
        }

        return this.formatResponse(
            'أفهم أن لديك سؤال. يمكنك شرح مشكلتك بشكل أكثر تفصيلاً؟\n' +
            'إذا كنت بحاجة إلى دعم بشري فوري، اضغط على زر 🛠️ "طلب دعم فني مباشر".',
            context
        );
    }

    formatResponse(text, context) {
        return new EmbedBuilder()
            .setColor(CONFIG.COLORS.INFO)
            .setTitle('🤖 المساعد الذكي')
            .setDescription(text)
            .addFields(
                { name: '💡 نصيحة سريعة', value: 'اكتب مشكلتك بشكل مفصل للحصول على مساعدة أفضل', inline: false },
                { name: '👥 فريق الدعم', value: 'سيتم إشعار فريق الدعم إذا احتجت إلى مساعدة بشرية', inline: false }
            )
            .setFooter({ text: 'هذا رد آلي - للدعم البشري اضغط على 🛠️' })
            .setTimestamp();
    }

    toggle(enabled) {
        this.isEnabled = enabled;
        return this.isEnabled;
    }
}

const ai = new AIAssistant();

// ============================================
// 🎫 مدير التذاكر
// ============================================
class TicketManager {
    constructor() {
        this.activeTickets = new Map();
        this.ticketCooldowns = new Map();
    }

    async createTicket(guild, user, reason) {
        const cooldownKey = `${guild.id}-${user.id}`;
        const cooldown = this.ticketCooldowns.get(cooldownKey);
        if (cooldown && Date.now() - cooldown < 60000) {
            throw new Error('⏳ يرجى الانتظار دقيقة قبل فتح تذكرة جديدة');
        }

        const settings = await db.get(
            'SELECT * FROM guild_settings WHERE guild_id = ?',
            [guild.id]
        );

        const ticketCounter = (settings?.ticket_counter || 0) + 1;
        const ticketId = `TICKET-${ticketCounter.toString().padStart(4, '0')}`;

        await db.run(
            'UPDATE guild_settings SET ticket_counter = ? WHERE guild_id = ?',
            [ticketCounter, guild.id]
        );

        let category = guild.channels.cache.find(c => 
            c.type === ChannelType.GuildCategory && 
            c.id === settings?.ticket_category_id
        );

        if (!category && settings?.ticket_category_id) {
            category = await guild.channels.fetch(settings.ticket_category_id).catch(() => null);
        }

        if (!category) {
            category = await guild.channels.create({
                name: CONFIG.CHANNELS.DEFAULT_CATEGORY_NAME,
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    }
                ]
            });

            await db.run(
                'INSERT OR REPLACE INTO guild_settings (guild_id, ticket_category_id) VALUES (?, ?)',
                [guild.id, category.id]
            );
        }

        const channelName = `🎫-${user.username}-${ticketCounter}`;
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `تذكرة ${ticketId} - ${user.tag} - ${reason}`,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ]
        });

        const supportRoles = await db.query(
            'SELECT role_id FROM support_roles WHERE guild_id = ?',
            [guild.id]
        );

        for (const roleData of supportRoles) {
            const role = guild.roles.cache.get(roleData.role_id);
            if (role) {
                await ticketChannel.permissionOverwrites.create(role, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    ManageMessages: true,
                    AttachFiles: true,
                    EmbedLinks: true
                });
            }
        }

        await ticketChannel.permissionOverwrites.create(client.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            ManageMessages: true,
            ManageChannels: true,
            AttachFiles: true,
            EmbedLinks: true
        });

        await db.run(
            `INSERT INTO tickets (
                ticket_id, channel_id, guild_id, user_id, user_tag, reason, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ticketId, ticketChannel.id, guild.id, user.id, user.tag, reason, 'open']
        );

        await db.run(
            `INSERT INTO user_stats (user_id, guild_id, tickets_opened, last_ticket_at) 
             VALUES (?, ?, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, guild_id) 
             DO UPDATE SET tickets_opened = tickets_opened + 1, last_ticket_at = CURRENT_TIMESTAMP`,
            [user.id, guild.id]
        );

        this.ticketCooldowns.set(cooldownKey, Date.now());

        this.activeTickets.set(ticketChannel.id, {
            id: ticketId,
            user: user.id,
            guild: guild.id,
            reason: reason,
            createdAt: new Date()
        });

        return { ticketId, channel: ticketChannel };
    }

    async closeTicket(channelId, closerId, reason = 'تم الإغلاق بواسطة فريق الدعم') {
        const ticket = await db.get(
            'SELECT * FROM tickets WHERE channel_id = ?',
            [channelId]
        );

        if (!ticket) throw new Error('التذكرة غير موجودة');

        await db.run(
            'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
            ['closed', channelId]
        );

        await db.run(
            `UPDATE user_stats SET tickets_closed = tickets_closed + 1 
             WHERE user_id = ? AND guild_id = ?`,
            [closerId, ticket.guild_id]
        );

        this.activeTickets.delete(channelId);

        return ticket;
    }

    async reopenTicket(channelId) {
        const ticket = await db.get(
            'SELECT * FROM tickets WHERE channel_id = ?',
            [channelId]
        );

        if (!ticket) throw new Error('التذكرة غير موجودة');

        await db.run(
            'UPDATE tickets SET status = ?, closed_at = NULL WHERE channel_id = ?',
            ['open', channelId]
        );

        this.activeTickets.set(channelId, {
            id: ticket.ticket_id,
            user: ticket.user_id,
            guild: ticket.guild_id,
            reason: ticket.reason,
            createdAt: new Date(ticket.created_at)
        });

        return ticket;
    }

    async deleteTicket(channelId) {
        const ticket = await db.get(
            'SELECT * FROM tickets WHERE channel_id = ?',
            [channelId]
        );

        if (!ticket) throw new Error('التذكرة غير موجودة');

        await db.run('DELETE FROM tickets WHERE channel_id = ?', [channelId]);
        await db.run('DELETE FROM chat_logs WHERE ticket_id = ?', [ticket.ticket_id]);

        this.activeTickets.delete(channelId);

        return ticket;
    }

    async claimTicket(channelId, userId) {
        const ticket = await db.get(
            'SELECT * FROM tickets WHERE channel_id = ?',
            [channelId]
        );

        if (!ticket) throw new Error('التذكرة غير موجودة');

        await db.run(
            'UPDATE tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
            [userId, channelId]
        );

        return ticket;
    }

    async getTicketStats(guildId) {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed
            FROM tickets 
            WHERE guild_id = ?
        `, [guildId]);

        return stats || { total: 0, open: 0, closed: 0 };
    }

    async saveChatLog(ticketId, userId, userTag, message, isSupport = false) {
        await db.run(
            `INSERT INTO chat_logs (ticket_id, user_id, user_tag, message, is_support) 
             VALUES (?, ?, ?, ?, ?)`,
            [ticketId, userId, userTag, message, isSupport ? 1 : 0]
        );
    }

    async generateTranscript(ticketId) {
        const logs = await db.query(
            'SELECT * FROM chat_logs WHERE ticket_id = ? ORDER BY timestamp ASC',
            [ticketId]
        );

        const ticket = await db.get(
            'SELECT * FROM tickets WHERE ticket_id = ?',
            [ticketId]
        );

        if (!ticket) return 'التذكرة غير موجودة';

        let transcript = `📄 محضر التذكرة ${ticketId}\n`;
        transcript += '='.repeat(50) + '\n\n';
        transcript += `👤 صاحب التذكرة: ${ticket.user_tag}\n`;
        transcript += `🎫 السبب: ${ticket.reason}\n`;
        transcript += `📅 تاريخ الإنشاء: ${new Date(ticket.created_at).toLocaleString('ar-SA')}\n`;
        
        if (ticket.closed_at) {
            transcript += `🔒 تاريخ الإغلاق: ${new Date(ticket.closed_at).toLocaleString('ar-SA')}\n`;
        }
        
        transcript += '='.repeat(50) + '\n\n';

        for (const log of logs) {
            const time = new Date(log.timestamp).toLocaleTimeString('ar-SA');
            const userType = log.is_support ? '[دعم]' : '[مستخدم]';
            transcript += `[${time}] ${userType} ${log.user_tag}: ${log.message}\n`;
        }

        return transcript;
    }
}

const ticketManager = new TicketManager();

// ============================================
// 🎨 مساعد الواجهات
// ============================================
class UIManager {
    createTicketEmbed() {
        return new EmbedBuilder()
            .setTitle('🎫 نظام التذاكر والدعم الفني')
            .setDescription('**مرحباً بك في نظام الدعم الفني!**\n\nاضغط على الزر أدناه لفتح تذكرة جديدة وسيتم إنشاء قناة خاصة بك فقط مع فريق الدعم.')
            .setColor(CONFIG.COLORS.PRIMARY)
            .addFields(
                {
                    name: '📋 أنواع التذاكر المتاحة:',
                    value: '• **🛠️ دعم فني**: مشاكل تقنية أو استفسارات\n' +
                           '• **🚨 بلاغ**: الإبلاغ عن مشاكل أو انتهاكات\n' +
                           '• **📮 اقتراح**: تقديم اقتراحات أو أفكار\n' +
                           '• **💰 شراء/اشتراك**: استفسارات مالية واشتراكات',
                    inline: false
                },
                {
                    name: '📜 قوانين لفتح تذكرة :',
                    value: '• **يمنع الخمول في التذكرة لأكثر من ساعتين**  \n' +
                           '• **يمكنك منشن الإدارة مرة واحدة فقط**   \n' +
                           '• **ممنوع فتح تذكرة للتجربة أو للسخرية**   \n',
                    inline: false
                }
            )
            .setFooter({ text: 'سيتم الرد عليك في أقرب وقت ممكن' })
            .setTimestamp();
    }

    createTicketButton() {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('فتح تذكرة جديدة')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎫')
            );
    }

    createReasonSelectMenu() {
        return new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_reason')
                    .setPlaceholder(' اختر سبب فتح التذكرة')
                    .addOptions([
                        {
                            label: '🛠️ دعم فني',
                            value: 'tech_support',
                            description: 'مساعدة في مشكلة تقنية أو استفسار'
                        },
                        {
                            label: '🚨 بلاغ',
                            value: 'report',
                            description: 'الإبلاغ عن مشكلة أو انتهاك'
                        },
                        {
                            label: '💡 اقتراح',
                            value: 'suggestion',
                            description: 'تقديم اقتراح أو فكرة جديدة'
                        },
                        {
                            label: '💰 شراء / اشتراك -   قريبا',
                            value: 'purchase',
                            description: 'استفسارات حول الشراء أو الاشتراكات'
                        }
                    ])
            );
    }

    createWelcomeEmbed(ticketId, user, reason) {
        const reasonText = {
            'tech_support': '🛠️ دعم فني',
            'report': '🚨 بلاغ',
            'suggestion': '💡 اقتراح',
            'purchase': '💰 شراء / اشتراك'
        }[reason] || reason;

        return new EmbedBuilder()
            .setTitle(`🎫 تذكرة ${ticketId}`)
            .setDescription(`**مرحباً ${user}!**\n\nتم فتح هذه التذكرة لمساعدتك في: **${reasonText}**`)
            .setColor(CONFIG.COLORS.SUCCESS)
            .addFields(
                {
                    name: '👤 صاحب التذكرة',
                    value: `<@${user.id}> (\`${user.tag}\`)`,
                    inline: true
                },
                {
                    name: '📅 تاريخ الإنشاء',
                    value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                    inline: true
                },
                {
                    name: '🎫 رقم التذكرة',
                    value: `\`${ticketId}\``,
                    inline: true
                },
                {
                    name: '🤖 المساعد الذكي',
                    value: 'سأحاول مساعدتك أولاً تلقائياً. إذا لم أستطع حلها، سيتم استدعاء فريق الدعم.',
                    inline: false
                },
                {
                    name: '📝 تعليمات',
                    value: '• اشرح مشكلتك بشكل مفصل\n• أرفق صوراً إذا لزم الأمر\n• انتظر رد المساعد الذكي\n• استخدم 🛠️ لطلب الدعم البشري',
                    inline: false
                }
            )
            .setFooter({ text: 'لإغلاق التذكرة اضغط على 🔒' })
            .setTimestamp();
    }

    createTicketControls() {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('إغلاق التذكرة')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('طلب دعم بشري')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🛠️'),
                new ButtonBuilder()
                    .setCustomId('save_transcript')
                    .setLabel('حفظ المحادثة')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('💾')
            );
    }

    createStatsEmbed(stats, guild) {
        return new EmbedBuilder()
            .setTitle('📊 إحصائيات التذاكر')
            .setColor(CONFIG.COLORS.INFO)
            .setThumbnail(guild.iconURL())
            .addFields(
                {
                    name: '📈 الإحصائيات العامة',
                    value: `• **إجمالي التذاكر:** ${stats.total}\n` +
                           `• **التذاكر المفتوحة:** ${stats.open}\n` +
                           `• **التذاكر المغلقة:** ${stats.closed}`,
                    inline: false
                },
                {
                    name: '📅 النشاط',
                    value: `• **النسبة النشطة:** ${((stats.open / stats.total) * 100 || 0).toFixed(1)}%\n` +
                           `• **معدل الإغلاق:** ${((stats.closed / stats.total) * 100 || 0).toFixed(1)}%`,
                    inline: false
                }
            )
            .setFooter({ text: `السيرفر: ${guild.name}` })
            .setTimestamp();
    }
}

const ui = new UIManager();

// ============================================
// 🔊 معالج السجلات
// ============================================
class Logger {
    async logAction(guild, action, details) {
        try {
            const settings = await db.get(
                'SELECT logs_channel_id FROM guild_settings WHERE guild_id = ?',
                [guild.id]
            );

            if (!settings?.logs_channel_id) return;

            const logChannel = guild.channels.cache.get(settings.logs_channel_id);
            if (!logChannel) return;

            const embed = new EmbedBuilder()
                .setColor(CONFIG.COLORS.INFO)
                .setTitle(`📝 ${action}`)
                .setDescription(details)
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('خطأ في التسجيل:', error);
        }
    }
}

const logger = new Logger();

// ============================================
// 🛡️ وظائف المساعدة
// ============================================
async function isSupportRole(member) {
    const supportRoles = await db.query(
        'SELECT role_id FROM support_roles WHERE guild_id = ?',
        [member.guild.id]
    );

    return supportRoles.some(role => member.roles.cache.has(role.role_id)) ||
           member.permissions.has(PermissionFlagsBits.Administrator);
}

function formatDuration(start, end) {
    const diff = Math.abs(end - start);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days} يوم و ${hours % 24} ساعة`;
    } else if (hours > 0) {
        return `${hours} ساعة و ${minutes % 60} دقيقة`;
    } else {
        return `${minutes} دقيقة`;
    }
}

// ============================================
// ⌨️ معالجة الأوامر
// ============================================
client.on('ready', async () => {
    console.log(`✅ ${client.user.tag} يعمل الآن!`);
    console.log(`📊 في ${client.guilds.cache.size} سيرفر`);
    console.log(`👥 ${client.users.cache.size} مستخدم`);

    client.user.setPresence({
        activities: [{
            name: `${client.guilds.cache.size} سيرفر | /setup`,
            type: ActivityType.Watching
        }],
        status: 'online'
    });

    registerCommands();
});

async function registerCommands() {
    const commands = [
        {
            name: 'setup',
            description: 'إعداد نظام التذاكر في السيرفر',
            default_member_permissions: PermissionFlagsBits.Administrator.toString()
        },
        {
            name: 'add-support-role',
            description: 'إضافة رتبة دعم',
            options: [{
                name: 'role',
                type: 8,
                description: 'الرتبة المراد إضافتها',
                required: true
            }],
            default_member_permissions: PermissionFlagsBits.Administrator.toString()
        },
        {
            name: 'remove-support-role',
            description: 'إزالة رتبة دعم',
            options: [{
                name: 'role',
                type: 8,
                description: 'الرتبة المراد إزالتها',
                required: true
            }],
            default_member_permissions: PermissionFlagsBits.Administrator.toString()
        },
        {
            name: 'ticket-stats',
            description: 'عرض إحصائيات التذاكر',
            default_member_permissions: PermissionFlagsBits.ManageChannels.toString()
        },
        {
            name: 'ai',
            description: 'تشغيل/إيقاف الذكاء الاصطناعي',
            options: [{
                name: 'status',
                type: 3,
                description: 'حالة الذكاء الاصطناعي',
                required: true,
                choices: [
                    { name: 'تشغيل', value: 'on' },
                    { name: 'إيقاف', value: 'off' }
                ]
            }],
            default_member_permissions: PermissionFlagsBits.Administrator.toString()
        },
        {
            name: 'transcript',
            description: 'حفظ محادثة التذكرة',
            options: [{
                name: 'ticket_id',
                type: 3,
                description: 'رقم التذكرة (اختياري - يستخدم القناة الحالية)',
                required: false
            }]
        },
        {
            name: 'config',
            description: 'عرض إعدادات النظام',
            default_member_permissions: PermissionFlagsBits.Administrator.toString()
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ تم تسجيل الأوامر بنجاح');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }
}

// ============================================
// 🔘 معالجة الأزرار والتفاعلات
// ============================================
client.on('interactionCreate', async interaction => {
    // معالجة الأوامر
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        switch (commandName) {
            case 'setup':
                await handleSetup(interaction);
                break;
            case 'add-support-role':
                await handleAddSupportRole(interaction);
                break;
            case 'remove-support-role':
                await handleRemoveSupportRole(interaction);
                break;
            case 'ticket-stats':
                await handleTicketStats(interaction);
                break;
            case 'ai':
                await handleAI(interaction);
                break;
            case 'transcript':
                await handleTranscript(interaction);
                break;
            case 'config':
                await handleConfig(interaction);
                break;
        }
    }

    // معالجة الأزرار
    if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
    }

    // معالجة القوائم المختصرة
    if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
    }

    // معالجة النماذج
    if (interaction.isModalSubmit()) {
        await handleModal(interaction);
    }
});

// ============================================
// 🛠️ معالجات الأوامر
// ============================================
async function handleSetup(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية **أدمن** لاستخدام هذا الأمر.',
            ephemeral: true
        });
    }

    try {
        const existingLogs = interaction.guild.channels.cache.find(
            c => c.name === CONFIG.CHANNELS.LOGS_CHANNEL_NAME && c.type === ChannelType.GuildText
        );

        let logsChannel = existingLogs;
        if (!existingLogs) {
            logsChannel = await interaction.guild.channels.create({
                name: CONFIG.CHANNELS.LOGS_CHANNEL_NAME,
                type: ChannelType.GuildText,
                topic: '📁 سجلات نظام التذاكر',
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
                    }
                ]
            });
        }

        await db.run(
            `INSERT OR REPLACE INTO guild_settings (guild_id, logs_channel_id) VALUES (?, ?)`,
            [interaction.guild.id, logsChannel.id]
        );

        const embed = ui.createTicketEmbed();
        const button = ui.createTicketButton();

        const setupMessage = await interaction.channel.send({
            embeds: [embed],
            components: [button]
        });

        await interaction.reply({
            content: `✅ تم إعداد نظام التذاكر بنجاح!\n• 📁 قناة السجلات: ${logsChannel}\n• 🎫 رسالة التذاكر: ${setupMessage.url}`,
            ephemeral: true
        });

        await logger.logAction(
            interaction.guild,
            'إعداد النظام',
            `تم إعداد نظام التذاكر بواسطة ${interaction.user.tag}`
        );

    } catch (error) {
        console.error('خطأ في الإعداد:', error);
        await interaction.reply({
            content: '❌ حدث خطأ أثناء الإعداد: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleAddSupportRole(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية **أدمن** لاستخدام هذا الأمر.',
            ephemeral: true
        });
    }

    const role = interaction.options.getRole('role');

    try {
        await db.run(
            'INSERT OR IGNORE INTO support_roles (guild_id, role_id, role_name) VALUES (?, ?, ?)',
            [interaction.guild.id, role.id, role.name]
        );

        await interaction.reply({
            content: `✅ تم إضافة رتبة الدعم **${role.name}** بنجاح`,
            ephemeral: true
        });

        await logger.logAction(
            interaction.guild,
            'إضافة رتبة دعم',
            `تمت إضافة ${role} بواسطة ${interaction.user.tag}`
        );

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleRemoveSupportRole(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية **أدمن** لاستخدام هذا الأمر.',
            ephemeral: true
        });
    }

    const role = interaction.options.getRole('role');

    try {
        const result = await db.run(
            'DELETE FROM support_roles WHERE guild_id = ? AND role_id = ?',
            [interaction.guild.id, role.id]
        );

        if (result.changes === 0) {
            return interaction.reply({
                content: '❌ هذه الرتبة غير مضاف كرتبة دعم',
                ephemeral: true
            });
        }

        await interaction.reply({
            content: `✅ تم إزالة رتبة الدعم **${role.name}** بنجاح`,
            ephemeral: true
        });

        await logger.logAction(
            interaction.guild,
            'إزالة رتبة دعم',
            `تمت إزالة ${role} بواسطة ${interaction.user.tag}`
        );

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleTicketStats(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية **إدارة القنوات** لاستخدام هذا الأمر.',
            ephemeral: true
        });
    }

    try {
        const stats = await ticketManager.getTicketStats(interaction.guild.id);
        const embed = ui.createStatsEmbed(stats, interaction.guild);
        
        await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleAI(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية **أدمن** لاستخدام هذا الأمر.',
            ephemeral: true
        });
    }

    const status = interaction.options.getString('status');
    const isEnabled = status === 'on';

    ai.toggle(isEnabled);

    await db.run(
        'UPDATE guild_settings SET ai_enabled = ? WHERE guild_id = ?',
        [isEnabled ? 1 : 0, interaction.guild.id]
    );

    await interaction.reply({
        content: `✅ تم **${isEnabled ? 'تشغيل' : 'إيقاف'}** الذكاء الاصطناعي بنجاح`,
        ephemeral: true
    });

    await logger.logAction(
        interaction.guild,
        'تغيير حالة الذكاء الاصطناعي',
        `تم ${isEnabled ? 'تشغيل' : 'إيقاف'} الذكاء الاصطناعي بواسطة ${interaction.user.tag}`
    );
}

async function handleTranscript(interaction) {
    const ticketId = interaction.options.getString('ticket_id');
    
    try {
        let targetTicketId = ticketId;
        
        if (!targetTicketId) {
            const ticket = await db.get(
                'SELECT ticket_id FROM tickets WHERE channel_id = ?',
                [interaction.channel.id]
            );
            
            if (!ticket) {
                return interaction.reply({
                    content: '❌ هذه ليست قناة تذكرة أو لم يتم تحديد رقم التذكرة',
                    ephemeral: true
                });
            }
            
            targetTicketId = ticket.ticket_id;
        }

        const transcript = await ticketManager.generateTranscript(targetTicketId);
        
        const fileName = `transcript_${targetTicketId}.txt`;
        await fs.writeFile(fileName, transcript, 'utf8');

        await interaction.reply({
            content: '📄 تم حفظ محضر المحادثة:',
            files: [fileName],
            ephemeral: true
        });

        setTimeout(() => {
            fs.unlink(fileName).catch(() => {});
        }, 5000);

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleConfig(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية **أدمن** لاستخدام هذا الأمر.',
            ephemeral: true
        });
    }

    try {
        const settings = await db.get(
            'SELECT * FROM guild_settings WHERE guild_id = ?',
            [interaction.guild.id]
        );

        const supportRoles = await db.query(
            'SELECT role_name FROM support_roles WHERE guild_id = ?',
            [interaction.guild.id]
        );

        const stats = await ticketManager.getTicketStats(interaction.guild.id);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعدادات النظام')
            .setColor(CONFIG.COLORS.INFO)
            .addFields(
                {
                    name: '🤖 الذكاء الاصطناعي',
                    value: settings?.ai_enabled ? '✅ مفعل' : '❌ معطل',
                    inline: true
                },
                {
                    name: '📊 إحصائيات التذاكر',
                    value: `• الإجمالي: ${stats.total}\n• المفتوحة: ${stats.open}\n• المغلقة: ${stats.closed}`,
                    inline: true
                },
                {
                    name: '👥 رتب الدعم',
                    value: supportRoles.length > 0 
                        ? supportRoles.map(r => `• ${r.role_name}`).join('\n')
                        : 'لا توجد رتب دعم',
                    inline: false
                }
            )
            .setFooter({ text: `آخر تحديث: ${new Date().toLocaleString('ar-SA')}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

// ============================================
// 🔘 معالجة الأزرار
// ============================================
async function handleButtonInteraction(interaction) {
    const { customId } = interaction;

    switch (customId) {
        case 'open_ticket':
            await handleOpenTicket(interaction);
            break;
        case 'close_ticket':
            await handleCloseTicket(interaction);
            break;
        case 'claim_ticket':
            await handleClaimTicket(interaction);
            break;
        case 'save_transcript':
            await handleSaveTranscript(interaction);
            break;
        case 'reopen_ticket':
            await handleReopenTicket(interaction);
            break;
    }
}

async function handleOpenTicket(interaction) {
    const selectMenu = ui.createReasonSelectMenu();
    
    await interaction.reply({
        content: '📝 **اختر سبب فتح التذكرة:**',
        components: [selectMenu],
        ephemeral: true
    });
}

async function handleCloseTicket(interaction) {
    try {
        const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
        const isSupport = await isSupportRole(interaction.member);
        
        if (!isAdmin && !isSupport) {
            return interaction.reply({
                content: '❌ تحتاج إلى صلاحية دعم فني أو أدمن لإغلاق التذاكر',
                ephemeral: true
            });
        }

        const ticket = await ticketManager.closeTicket(interaction.channel.id, interaction.user.id);

        const embed = new EmbedBuilder()
            .setTitle('🔒 تم إغلاق التذكرة')
            .setDescription(`تم إغلاق التذكرة ${ticket.ticket_id} بواسطة ${interaction.user}`)
            .setColor(CONFIG.COLORS.ERROR)
            .addFields(
                { name: '👤 صاحب التذكرة', value: `<@${ticket.user_id}>`, inline: true },
                { name: '🎫 السبب', value: ticket.reason, inline: true },
                { name: '📅 مدة التذكرة', value: formatDuration(new Date(ticket.created_at), new Date()), inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
            SendMessages: false,
            AddReactions: false
        });

        const reopenButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('reopen_ticket')
                    .setLabel('إعادة فتح التذكرة')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🔓')
            );

        await interaction.channel.send({
            content: '**🔒 تم إغلاق هذه التذكرة**\nلإعادة الفتح، اضغط على الزر أدناه:',
            components: [reopenButton]
        });

        await logger.logAction(
            interaction.guild,
            'إغلاق تذكرة',
            `تم إغلاق التذكرة ${ticket.ticket_id} بواسطة ${interaction.user.tag}`
        );

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleClaimTicket(interaction) {
    try {
        const isSupport = await isSupportRole(interaction.member);
        
        if (!isSupport) {
            return interaction.reply({
                content: '❌ هذا الزر مخصص لفريق الدعم فقط',
                ephemeral: true
            });
        }

        const ticket = await db.get(
            'SELECT * FROM tickets WHERE channel_id = ?',
            [interaction.channel.id]
        );

        if (!ticket) {
            return interaction.reply({
                content: '❌ هذه ليست قناة تذكرة',
                ephemeral: true
            });
        }

        if (ticket.claimed_by) {
            return interaction.reply({
                content: `⚠️ هذه التذكرة مسؤول عنها بالفعل <@${ticket.claimed_by}>`,
                ephemeral: true
            });
        }

        await ticketManager.claimTicket(interaction.channel.id, interaction.user.id);

        const embed = new EmbedBuilder()
            .setTitle('🛠️ طلب دعم فني مباشر')
            .setDescription(`قام ${interaction.user} بطلب تدخل فريق الدعم`)
            .setColor(CONFIG.COLORS.WARNING)
            .addFields(
                { name: '🎫 رقم التذكرة', value: ticket.ticket_id, inline: true },
                { name: '👤 صاحب التذكرة', value: `<@${ticket.user_id}>`, inline: true },
                { name: '⏰ وقت الانتظار', value: formatDuration(new Date(ticket.created_at), new Date()), inline: true }
            )
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });

        const supportRoles = await db.query(
            'SELECT role_id FROM support_roles WHERE guild_id = ?',
            [interaction.guild.id]
        );

        const mentions = supportRoles.map(r => `<@&${r.role_id}>`).join(' ');
        if (mentions) {
            await interaction.channel.send(`📢 ${mentions} - تم طلب دعم فني مباشر!`);
        }

        await interaction.reply({
            content: '✅ تم إرسال طلب الدعم الفني',
            ephemeral: true
        });

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleSaveTranscript(interaction) {
    try {
        const ticket = await db.get(
            'SELECT ticket_id FROM tickets WHERE channel_id = ?',
            [interaction.channel.id]
        );

        if (!ticket) {
            return interaction.reply({
                content: '❌ هذه ليست قناة تذكرة',
                ephemeral: true
            });
        }

        const transcript = await ticketManager.generateTranscript(ticket.ticket_id);
        const fileName = `transcript_${ticket.ticket_id}.txt`;
        
        await fs.writeFile(fileName, transcript, 'utf8');

        await interaction.reply({
            content: '📄 تم حفظ محضر المحادثة:',
            files: [fileName],
            ephemeral: true
        });

        setTimeout(() => {
            fs.unlink(fileName).catch(() => {});
        }, 5000);

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

async function handleReopenTicket(interaction) {
    const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
    const isSupport = await isSupportRole(interaction.member);
    
    if (!isAdmin && !isSupport) {
        return interaction.reply({
            content: '❌ تحتاج إلى صلاحية دعم فني أو أدمن لإعادة فتح التذاكر',
            ephemeral: true
        });
    }

    try {
        const ticket = await ticketManager.reopenTicket(interaction.channel.id);

        if (!ticket) {
            return interaction.reply({
                content: '❌ هذه ليست قناة تذكرة',
                ephemeral: true
            });
        }

        await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
            SendMessages: true,
            AddReactions: true
        });

        const embed = new EmbedBuilder()
            .setTitle('🔓 تم إعادة فتح التذكرة')
            .setDescription(`أعيد فتح التذكرة ${ticket.ticket_id} بواسطة ${interaction.user}`)
            .setColor(CONFIG.COLORS.SUCCESS)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        const messages = await interaction.channel.messages.fetch({ limit: 10 });
        const closeMessage = messages.find(m => 
            m.components.length > 0 && 
            m.components[0].components.some(c => c.customId === 'reopen_ticket')
        );
        
        if (closeMessage) {
            await closeMessage.delete().catch(() => {});
        }

        await logger.logAction(
            interaction.guild,
            'إعادة فتح تذكرة',
            `أعيد فتح التذكرة ${ticket.ticket_id} بواسطة ${interaction.user.tag}`
        );

    } catch (error) {
        await interaction.reply({
            content: '❌ حدث خطأ: ' + error.message,
            ephemeral: true
        });
    }
}

// ============================================
// 📝 معالجة القوائم المختصرة
// ============================================
async function handleSelectMenu(interaction) {
    if (interaction.customId === 'select_reason') {
        const reason = interaction.values[0];
        
        await interaction.deferReply({ ephemeral: true });

        try {
            const { ticketId, channel } = await ticketManager.createTicket(
                interaction.guild,
                interaction.user,
                reason
            );

            const welcomeEmbed = ui.createWelcomeEmbed(ticketId, interaction.user, reason);
            const controls = ui.createTicketControls();

            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [welcomeEmbed],
                components: [controls]
            });

            await channel.send('**👇 اشرح مشكلتك بالتفصيل هنا، وسأحاول مساعدتك:**');

            await interaction.editReply({
                content: `✅ تم إنشاء تذكرتك: ${channel}\n🎫 الرقم: \`${ticketId}\``
            });

            await logger.logAction(
                interaction.guild,
                'فتح تذكرة',
                `${interaction.user.tag} فتح تذكرة ${ticketId} للسبب: ${reason}`
            );

        } catch (error) {
            await interaction.editReply({
                content: `❌ حدث خطأ: ${error.message}`
            });
        }
    }
}

// ============================================
// 💬 معالجة الرسائل والذكاء الاصطناعي
// ============================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const ticket = await db.get(
        'SELECT * FROM tickets WHERE channel_id = ? AND status = ?',
        [message.channel.id, 'open']
    );

    if (ticket) {
        const isSupport = await isSupportRole(message.member);
        await ticketManager.saveChatLog(
            ticket.ticket_id,
            message.author.id,
            message.author.tag,
            message.content,
            isSupport
        );

        if (!isSupport) {
            const settings = await db.get(
                'SELECT ai_enabled FROM guild_settings WHERE guild_id = ?',
                [message.guild.id]
            );

            if (settings?.ai_enabled && ai.isEnabled) {
                setTimeout(async () => {
                    try {
                        const aiResponse = await ai.generateResponse(message.content, {
                            ticketId: ticket.ticket_id,
                            reason: ticket.reason
                        });

                        if (aiResponse) {
                            const response = await message.channel.send({ embeds: [aiResponse] });
                            
                            await ticketManager.saveChatLog(
                                ticket.ticket_id,
                                client.user.id,
                                client.user.tag,
                                aiResponse.data.description || 'رد الذكاء الاصطناعي',
                                true
                            );
                        }
                    } catch (error) {
                        console.error('خطأ في الذكاء الاصطناعي:', error);
                    }
                }, 1500);
            }
        }
    }
});

// ============================================
// 🌐 خادم ويب للحفاظ على التشغيل
// ============================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🎫 بوت تذاكر Discord يعمل بشكل طبيعي\n' +
           `🕒 الوقت: ${new Date().toLocaleString('ar-SA')}\n` +
           `📊 السيرفرات: ${client.guilds?.cache?.size || 0}\n` +
           `👥 المستخدمون: ${client.users?.cache?.size || 0}`);
});

server.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 خادم الويب يعمل على المنفذ: ${process.env.PORT || 3000}`);
});

// ============================================
// 🚀 تشغيل البوت
// ============================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ||  


client.login(DISCORD_TOKEN).catch(error => {
    console.error('❌ فشل تسجيل الدخول:', error);
    process.exit(1);
});

// ============================================
// 🛡️ معالجة الأخطاء
// ============================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ خطأ غير معالج:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ استثناء غير مكتشف:', error);
});

// ============================================
// 📋 تعليمات التشغيل السريع
// ============================================
console.log(`
🎫 بوت تذاكر Discord مع الذكاء الاصطناعي
===========================================

✅ الإصدار: 2.0.0 (مصحح)
✅ الأخطاء المصححة:
  - ✅ permissionOverwrites (بدلاً من permissionOverwrides)
  - ✅ formatDuration (بدلاً من this.formatDuration)
  - ✅ دمج معالجة reopen_ticket
  - ✅ الذكاء الاصطناعي يتحقق من إعداد السيرفر
  - ✅ claim حقيقي مع تحقق الصلاحيات
  - ✅ إعادة إضافة التذاكر إلى activeTickets عند إعادة الفتح

⚡ أوامر البوت:
1. /setup - إعداد النظام في السيرفر
2. /add-support-role - إضافة رتبة دعم
3. /ticket-stats - إحصائيات التذاكر
4. /ai on/off - التحكم بالذكاء الاصطناعي
5. /transcript - حفظ محضر المحادثة

🚀 التشغيل:
node bot.js

===========================================
`);