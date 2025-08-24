import discord
from discord.ext import commands, tasks
import sqlite3
import asyncio
import json
import random
from datetime import datetime, timedelta
import io
import os

# Bot setup
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
bot = commands.Bot(command_prefix='!', intents=intents)

# Database setup
def init_db():
    conn = sqlite3.connect('bot.db')
    cursor = conn.cursor()
    
    # Tickets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER,
            user_id INTEGER,
            category TEXT,
            claimed_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Giveaways table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS giveaways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            channel_id INTEGER,
            prize TEXT,
            winners INTEGER,
            end_time TIMESTAMP,
            creator_id INTEGER,
            ended BOOLEAN DEFAULT FALSE
        )
    ''')
    
    # Config table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS config (
            guild_id INTEGER,
            ticket_category INTEGER,
            ticket_log_channel INTEGER,
            join_channel INTEGER,
            vouch_channel INTEGER,
            vouch_role INTEGER,
            PRIMARY KEY (guild_id)
        )
    ''')
    
    # Giveaway entries table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS giveaway_entries (
            giveaway_id INTEGER,
            user_id INTEGER,
            PRIMARY KEY (giveaway_id, user_id),
            FOREIGN KEY (giveaway_id) REFERENCES giveaways (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Database helper functions
def get_db():
    return sqlite3.connect('bot.db')

def get_config(guild_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM config WHERE guild_id = ?', (guild_id,))
    result = cursor.fetchone()
    conn.close()
    return result

# Ticket System
class TicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    
    @discord.ui.button(label='General Support', style=discord.ButtonStyle.primary, emoji='🎫')
    async def general_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.create_ticket(interaction, 'general')
    
    @discord.ui.button(label='Store Support', style=discord.ButtonStyle.success, emoji='🛒')
    async def store_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.create_ticket(interaction, 'store')
    
    @discord.ui.button(label='Management', style=discord.ButtonStyle.danger, emoji='👑')
    async def management_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.create_ticket(interaction, 'management')
    
    async def create_ticket(self, interaction, category):
        guild = interaction.guild
        user = interaction.user
        
        config = get_config(guild.id)
        if not config:
            await interaction.response.send_message("Ticket system not configured!", ephemeral=True)
            return
        
        ticket_category = guild.get_channel(config[1])
        if not ticket_category:
            await interaction.response.send_message("Ticket category not found!", ephemeral=True)
            return
        
        # Check if user already has an open ticket
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT channel_id FROM tickets WHERE user_id = ?', (user.id,))
        existing = cursor.fetchone()
        
        if existing:
            channel = guild.get_channel(existing[0])
            if channel:
                await interaction.response.send_message(f"You already have an open ticket: {channel.mention}", ephemeral=True)
                conn.close()
                return
        
        # Create ticket channel
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            user: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
            guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)
        }
        
        channel = await ticket_category.create_text_channel(
            name=f'ticket-{user.display_name}',
            overwrites=overwrites
        )
        
        # Save to database
        cursor.execute('INSERT INTO tickets (channel_id, user_id, category) VALUES (?, ?, ?)',
                      (channel.id, user.id, category))
        conn.commit()
        conn.close()
        
        # Send ticket message
        embed = discord.Embed(
            title=f"{category.title()} Support Ticket",
            description=f"Welcome {user.mention}! Please describe your issue and a staff member will assist you shortly.",
            color=0x00ff00
        )
        embed.add_field(name="Category", value=category.title(), inline=True)
        embed.add_field(name="Created by", value=user.mention, inline=True)
        embed.timestamp = datetime.now()
        
        view = TicketControlView()
        await channel.send(embed=embed, view=view)
        
        await interaction.response.send_message(f"Ticket created! {channel.mention}", ephemeral=True)

class TicketControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    
    @discord.ui.button(label='Claim', style=discord.ButtonStyle.primary, emoji='✋')
    async def claim_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.user.guild_permissions.manage_channels:
            await interaction.response.send_message("You don't have permission to claim tickets!", ephemeral=True)
            return
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?', 
                      (interaction.user.id, interaction.channel.id))
        
        if cursor.rowcount > 0:
            embed = discord.Embed(
                title="Ticket Claimed",
                description=f"This ticket has been claimed by {interaction.user.mention}",
                color=0xffff00
            )
            await interaction.response.send_message(embed=embed)
        else:
            await interaction.response.send_message("Ticket not found in database!", ephemeral=True)
        
        conn.commit()
        conn.close()
    
    @discord.ui.button(label='Close', style=discord.ButtonStyle.danger, emoji='🔒')
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.user.guild_permissions.manage_channels:
            await interaction.response.send_message("You don't have permission to close tickets!", ephemeral=True)
            return
        
        embed = discord.Embed(
            title="Closing Ticket",
            description="This ticket will be closed in 5 seconds...",
            color=0xff0000
        )
        await interaction.response.send_message(embed=embed)
        
        await asyncio.sleep(5)
        
        # Create transcript
        transcript = await self.create_transcript(interaction.channel)
        
        # Send transcript to log channel
        config = get_config(interaction.guild.id)
        if config and config[2]:
            log_channel = interaction.guild.get_channel(config[2])
            if log_channel:
                embed = discord.Embed(
                    title="Ticket Closed",
                    description=f"Ticket {interaction.channel.name} has been closed",
                    color=0xff0000
                )
                embed.add_field(name="Closed by", value=interaction.user.mention, inline=True)
                embed.timestamp = datetime.now()
                
                await log_channel.send(embed=embed, file=transcript)
        
        # Delete from database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM tickets WHERE channel_id = ?', (interaction.channel.id,))
        conn.commit()
        conn.close()
        
        await interaction.channel.delete()
    
    @discord.ui.button(label='Delete', style=discord.ButtonStyle.danger, emoji='🗑️')
    async def delete_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.user.guild_permissions.manage_channels:
            await interaction.response.send_message("You don't have permission to delete tickets!", ephemeral=True)
            return
        
        # Delete from database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM tickets WHERE channel_id = ?', (interaction.channel.id,))
        conn.commit()
        conn.close()
        
        await interaction.response.send_message("Deleting ticket immediately...")
        await asyncio.sleep(1)
        await interaction.channel.delete()
    
    async def create_transcript(self, channel):
        messages = []
        async for message in channel.history(limit=None, oldest_first=True):
            timestamp = message.created_at.strftime('%Y-%m-%d %H:%M:%S')
            content = f"[{timestamp}] {message.author}: {message.content}\n"
            messages.append(content)
        
        transcript_content = ''.join(messages)
        transcript_file = discord.File(
            io.StringIO(transcript_content),
            filename=f'transcript-{channel.name}.txt'
        )
        return transcript_file

# Giveaway System
class GiveawayView(discord.ui.View):
    def __init__(self, giveaway_id):
        super().__init__(timeout=None)
        self.giveaway_id = giveaway_id
    
    @discord.ui.button(label='🎉', style=discord.ButtonStyle.primary)
    async def enter_giveaway(self, interaction: discord.Interaction, button: discord.ui.Button):
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if already entered
        cursor.execute('SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?',
                      (self.giveaway_id, interaction.user.id))
        if cursor.fetchone():
            await interaction.response.send_message("You're already entered in this giveaway!", ephemeral=True)
            conn.close()
            return
        
        # Enter giveaway
        cursor.execute('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)',
                      (self.giveaway_id, interaction.user.id))
        conn.commit()
        
        # Get entry count
        cursor.execute('SELECT COUNT(*) FROM giveaway_entries WHERE giveaway_id = ?', (self.giveaway_id,))
        entries = cursor.fetchone()[0]
        
        await interaction.response.send_message(f"You've been entered! Total entries: {entries}", ephemeral=True)
        conn.close()

@tasks.loop(minutes=1)
async def check_giveaways():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM giveaways WHERE ended = FALSE AND end_time <= ?', (datetime.now(),))
    expired_giveaways = cursor.fetchall()
    
    for giveaway in expired_giveaways:
        await end_giveaway(giveaway)
    
    conn.close()

async def end_giveaway(giveaway_data):
    conn = get_db()
    cursor = conn.cursor()
    
    giveaway_id, message_id, channel_id, prize, winners_count, end_time, creator_id, ended = giveaway_data
    
    channel = bot.get_channel(channel_id)
    if not channel:
        return
    
    try:
        message = await channel.fetch_message(message_id)
    except:
        return
    
    # Get entries
    cursor.execute('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', (giveaway_id,))
    entries = [row[0] for row in cursor.fetchall()]
    
    if len(entries) < winners_count:
        winners = entries
    else:
        winners = random.sample(entries, winners_count)
    
    # Mark as ended
    cursor.execute('UPDATE giveaways SET ended = TRUE WHERE id = ?', (giveaway_id,))
    conn.commit()
    
    if winners:
        winner_mentions = [f"<@{winner}>" for winner in winners]
        embed = discord.Embed(
            title="🎉 Giveaway Ended!",
            description=f"**Prize:** {prize}\n**Winners:** {', '.join(winner_mentions)}",
            color=0x00ff00
        )
    else:
        embed = discord.Embed(
            title="🎉 Giveaway Ended!",
            description=f"**Prize:** {prize}\n**Winners:** No valid entries",
            color=0xff0000
        )
    
    await message.edit(embed=embed, view=None)
    
    if winners:
        await channel.send(f"Congratulations {', '.join(winner_mentions)}! You won **{prize}**!")
    
    conn.close()

# Commands
@bot.event
async def on_ready():
    print(f'{bot.user} has logged in!')
    init_db()
    
    # Add persistent views
    bot.add_view(TicketView())
    bot.add_view(TicketControlView())
    
    if not check_giveaways.is_running():
        check_giveaways.start()

@bot.slash_command(description="Setup the ticket system")
@discord.default_permissions(administrator=True)
async def setup_tickets(ctx, category: discord.CategoryChannel, log_channel: discord.TextChannel):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''INSERT OR REPLACE INTO config (guild_id, ticket_category, ticket_log_channel)
                     VALUES (?, ?, ?)''', (ctx.guild.id, category.id, log_channel.id))
    conn.commit()
    conn.close()
    
    embed = discord.Embed(
        title="🎫 Create a Ticket",
        description="Click a button below to create a support ticket:",
        color=0x00ff00
    )
    embed.add_field(name="🎫 General Support", value="General questions and support", inline=False)
    embed.add_field(name="🛒 Store Support", value="Purchase and order related issues", inline=False)
    embed.add_field(name="👑 Management", value="Contact server management", inline=False)
    
    view = TicketView()
    await ctx.respond(embed=embed, view=view)

@bot.slash_command(description="Start a giveaway")
@discord.default_permissions(manage_guild=True)
async def gstart(ctx, duration: str, winners: int, *, prize: str):
    # Parse duration
    time_dict = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    amount = int(duration[:-1])
    unit = duration[-1].lower()
    
    if unit not in time_dict:
        await ctx.respond("Invalid duration format! Use s/m/h/d (e.g., 1h, 30m)", ephemeral=True)
        return
    
    end_time = datetime.now() + timedelta(seconds=amount * time_dict[unit])
    
    embed = discord.Embed(
        title="🎉 Giveaway!",
        description=f"**Prize:** {prize}\n**Winners:** {winners}\n**Ends:** <t:{int(end_time.timestamp())}:R>",
        color=0x00ff00
    )
    embed.set_footer(text=f"Hosted by {ctx.author}")
    
    # Save to database first
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''INSERT INTO giveaways (channel_id, prize, winners, end_time, creator_id)
                     VALUES (?, ?, ?, ?, ?)''',
                  (ctx.channel.id, prize, winners, end_time, ctx.author.id))
    giveaway_id = cursor.lastrowid
    
    view = GiveawayView(giveaway_id)
    await ctx.respond(embed=embed, view=view)
    
    # Get message ID and update database
    message = await ctx.interaction.original_response()
    cursor.execute('UPDATE giveaways SET message_id = ? WHERE id = ?', (message.id, giveaway_id))
    conn.commit()
    conn.close()

@bot.slash_command(description="Force end a giveaway")
@discord.default_permissions(manage_guild=True)
async def gend(ctx, message_id: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM giveaways WHERE message_id = ? AND ended = FALSE', (int(message_id),))
    giveaway = cursor.fetchone()
    
    if not giveaway:
        await ctx.respond("Giveaway not found or already ended!", ephemeral=True)
        conn.close()
        return
    
    await end_giveaway(giveaway)
    await ctx.respond("Giveaway ended!", ephemeral=True)
    conn.close()

@bot.slash_command(description="Reroll a giveaway")
@discord.default_permissions(manage_guild=True)
async def greroll(ctx, message_id: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM giveaways WHERE message_id = ?', (int(message_id),))
    giveaway = cursor.fetchone()
    
    if not giveaway:
        await ctx.respond("Giveaway not found!", ephemeral=True)
        conn.close()
        return
    
    giveaway_id, message_id, channel_id, prize, winners_count, end_time, creator_id, ended = giveaway
    
    # Get entries
    cursor.execute('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?', (giveaway_id,))
    entries = [row[0] for row in cursor.fetchall()]
    
    if len(entries) < winners_count:
        winners = entries
    else:
        winners = random.sample(entries, winners_count)
    
    if winners:
        winner_mentions = [f"<@{winner}>" for winner in winners]
        embed = discord.Embed(
            title="🎉 Giveaway Rerolled!",
            description=f"**Prize:** {prize}\n**New Winners:** {', '.join(winner_mentions)}",
            color=0x00ff00
        )
        await ctx.respond(embed=embed)
        await ctx.followup.send(f"Congratulations {', '.join(winner_mentions)}! You won **{prize}**!")
    else:
        await ctx.respond("No entries to reroll!", ephemeral=True)
    
    conn.close()

@bot.slash_command(description="Delete a giveaway")
@discord.default_permissions(manage_guild=True)
async def gdelete(ctx, message_id: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM giveaway_entries WHERE giveaway_id IN (SELECT id FROM giveaways WHERE message_id = ?)', (int(message_id),))
    cursor.execute('DELETE FROM giveaways WHERE message_id = ?', (int(message_id),))
    
    if cursor.rowcount > 0:
        await ctx.respond("Giveaway deleted!", ephemeral=True)
    else:
        await ctx.respond("Giveaway not found!", ephemeral=True)
    
    conn.commit()
    conn.close()

@bot.slash_command(description="Setup join messages")
@discord.default_permissions(administrator=True)
async def setup_join(ctx, channel: discord.TextChannel):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''INSERT OR REPLACE INTO config (guild_id, join_channel)
                     VALUES (?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET join_channel = ?''',
                  (ctx.guild.id, channel.id, channel.id))
    conn.commit()
    conn.close()
    
    await ctx.respond(f"Join messages will be sent to {channel.mention}!", ephemeral=True)

@bot.slash_command(description="Setup vouch system")
@discord.default_permissions(administrator=True)
async def setup_vouch(ctx, vouch_channel: discord.TextChannel, vouch_role: discord.Role):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''INSERT OR REPLACE INTO config (guild_id, vouch_channel, vouch_role)
                     VALUES (?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET vouch_channel = ?, vouch_role = ?''',
                  (ctx.guild.id, vouch_channel.id, vouch_role.id, vouch_channel.id, vouch_role.id))
    conn.commit()
    conn.close()
    
    await ctx.respond(f"Vouch system setup! Channel: {vouch_channel.mention}, Role: {vouch_role.mention}", ephemeral=True)

@bot.slash_command(description="Leave a vouch with star rating")
async def vouch(ctx, user: discord.Member, stars: int, *, review: str):
    if stars < 1 or stars > 5:
        await ctx.respond("Stars must be between 1 and 5!", ephemeral=True)
        return
    
    config = get_config(ctx.guild.id)
    if not config or not config[3] or not config[4]:
        await ctx.respond("Vouch system not configured!", ephemeral=True)
        return
    
    vouch_role = ctx.guild.get_role(config[4])
    if vouch_role not in ctx.author.roles:
        await ctx.respond("You don't have permission to leave vouches!", ephemeral=True)
        return
    
    vouch_channel = ctx.guild.get_channel(config[3])
    if not vouch_channel:
        await ctx.respond("Vouch channel not found!", ephemeral=True)
        return
    
    star_display = "⭐" * stars + "☆" * (5 - stars)
    
    embed = discord.Embed(
        title="New Vouch!",
        color=0xffd700
    )
    embed.add_field(name="For", value=user.mention, inline=True)
    embed.add_field(name="From", value=ctx.author.mention, inline=True)
    embed.add_field(name="Rating", value=star_display, inline=True)
    embed.add_field(name="Review", value=review, inline=False)
    embed.timestamp = datetime.now()
    embed.set_thumbnail(url=user.display_avatar.url)
    
    await vouch_channel.send(embed=embed)
    await ctx.respond("Vouch submitted!", ephemeral=True)

@bot.event
async def on_member_join(member):
    config = get_config(member.guild.id)
    if not config or not config[2]:
        return
    
    join_channel = member.guild.get_channel(config[2])
    if not join_channel:
        return
    
    embed = discord.Embed(
        title="Welcome to the server!",
        description=f"Hey {member.mention}, welcome to **{member.guild.name}**!",
        color=0x00ff00
    )
    embed.set_thumbnail(url=member.display_avatar.url)
    embed.add_field(name="Member Count", value=f"You're member #{len(member.guild.members)}", inline=True)
    embed.add_field(name="Account Created", value=f"<t:{int(member.created_at.timestamp())}:R>", inline=True)
    embed.timestamp = datetime.now()
    
    await join_channel.send(embed=embed)

# Run the bot
bot.run('MTQwODg5MDg0ODA3NDI2ODcxMw.GrnTcj.JmxNXj__DLuDbkPXAYjdMuHE_2UOABHfPD_GCg')
