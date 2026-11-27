// Email sequences carried over from MailerLite (automations "2 Ways to Win – Entrant Funnel" and
// "TakeKash trial to paid"), same words and links, in TakeKash's own email template.
// MailerLite branched on clicks; TakeKash Lists sends every step in order (noted per step).
const btn = (href, label) => `<p style="margin:18px 0"><a href="${href}" style="background:#2fe07c;color:#04210f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;display:inline-block">${label}</a></p>`;
const wrap = (h, ...body) => `<div style="font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.55;color:#1d2420;max-width:600px">` +
  `<h2 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:#0b0d0c">${h}</h2>${body.join("")}</div>`;
const p = (t) => `<p style="margin:0 0 12px">${t}</p>`;

const SEQUENCES = [
  { id: "free-ad-trial", name: "Free Ad Trial", steps: [
    { delayHours: 0, subject: "Your free ad is reserved. Send me 3 things", html: wrap("Your free TakeKash ad is reserved.",
      p("We make your first vertical ad free: 15 to 30 seconds, built for TikTok, Reels and Shorts, with captions, hook and the hashtags people actually search."),
      p("Reply to this email with: 1) your product or shop link, 2) your logo (or just your brand name), 3) the one thing you want people to do (buy, follow, book). That's it. Your ad comes back in about 48 hours."),
      btn("https://www.tiktok.com/@takekashgaming", "See our work"), p("GtaxZombies, TakeKash")) },
    { delayHours: 48, subject: "What a TakeKash ad looks like", html: wrap("Character-driven ads people actually watch.",
      p("Our house character KASH tours products the way a creator would, with motion, voice and captions, not a slideshow. Every ad ships with a ready-to-post title, description and top hashtags for each platform."),
      p("Haven't replied with your link yet? Hit reply now and you're next in the queue.")) },
    { delayHours: 72, subject: "Want 3 more after your free one?", html: wrap("Founding brand spots are limited.",
      p("After your free ad, founding brands lock in their price for life on ad packs (3 ads a month), plus we can boost the best one on TikTok so it reaches people who don't follow you yet."),
      p("Reply \"MORE\" and I'll send the options. Spots are capped so every ad gets real attention."), p("GtaxZombies, TakeKash")) },
  ] },
  { id: "giveaway-entrant", name: "2 Ways to Win – Entrant Funnel", steps: [
    { delayHours: 0, subject: "You're in. Here's how to double your shot 🧟", html: wrap("You're officially entered.",
      p("Welcome to the GtaxZombies squad. The 2 Ways to Win giveaway runs on two milestones: one drops when TikTok hits 10K, the other when YouTube hits 1,100 subscribers. Every follow pushes us closer to the drop."),
      p("Way #1: Follow on TikTok and turn on notifications so you catch the winner announcement live."), btn("https://www.tiktok.com/@gtaxzombies", "Follow on TikTok"),
      p("Way #2: Subscribe on YouTube for your second shot."), btn("https://www.youtube.com/@gtaxzombies", "Subscribe on YouTube")) },
    { delayHours: 48, subject: "Want the drop to come faster?", html: wrap("The faster we hit the milestone, the faster someone wins.",
      p("Send this to one friend who plays Warzone, Apex or 2K. When they join, the counter moves and the prize drop gets closer for everyone, including you."),
      p("Catch the live grind on Twitch, where winners get shouted out on stream."), btn("https://www.twitch.tv/gtaxzombies", "Watch live on Twitch")) },
    { delayHours: 72, subject: "Last call: you've only used 1 of 2 ways to win", html: wrap("Don't leave an entry on the table.",
      p("You signed up, but your second way to win is still open. Follow on TikTok and subscribe on YouTube so you're covered when the milestone prizes drop."),
      btn("https://www.youtube.com/@gtaxzombies", "Lock in entry #2")) },
    { delayHours: 24, subject: "Do you stream too? Read this.", html: wrap("Your best moments are dying in your VODs.",
      p("GtaxZombies Clip Studio turns your streams into ready-to-post TikTok, Shorts and Reels clips. Only clips that score 90% or better make the cut, the same standard used on the GtaxZombies channels."),
      p("Reply to this email with your Twitch or YouTube link and you'll get a free sample clip from your own stream."),
      btn("https://www.tiktok.com/@takekashgaming", "See the clips")) },
  ] },
  { id: "trial-to-paid", name: "TakeKash trial to paid", steps: [
    { delayHours: 0, subject: "Your first 3 clips are waiting", html: wrap("Welcome to TakeKash",
      p("I built TakeKash because I was tired of losing my best Warzone and Apex moments in 6-hour VODs. Now it does the digging for me, and it'll do it for you."),
      p("Your trial includes 3 clips. Here's the fastest way to use them: paste a link to your most recent stream or upload the file. TakeKash finds the moments with the biggest reactions, crops them vertical, adds captions, and ranks them."),
      btn("https://takekash.com", "Clip my last stream"), p("Reply to this email if anything breaks. It comes straight to me. GtaxZombies")) },
    { delayHours: 48, subject: "Why I only post clips that score 90+", html: wrap("Post fewer clips. Post better ones.",
      p("Every clip TakeKash makes gets a score for its hook, its payoff and whether it makes sense on its own. On my own channels, nothing under 90 gets posted."),
      p("Three average clips teach the algorithm your content is average. One great clip teaches it the opposite. Check your scores, post your top clip today, and let the rest go."),
      btn("https://takekash.com/portal", "See my clip scores"), p("GtaxZombies")) },
    { delayHours: 72, subject: "Keep clipping for $9.99 a month", html: wrap("Your trial clips are used up. Your stream backlog isn't.",
      p("TakeKash Pro is $9.99 a month: unlimited clips from every stream, auto captions, vertical crops with face tracking, and auto-posting to TikTok, YouTube Shorts and Instagram."),
      p("That's less than one hour of editing would cost you, every month."), btn("https://takekash.com", "Go Pro for $9.99"), p("Cancel any time. GtaxZombies")) },
    { delayHours: 96, subject: "Want me to just do it for you?", html: wrap("No time to clip? That's what Clip Studio is for.",
      p("Some creators don't want another app. They want the clips handled. Clip Studio does exactly that: we pull your best moments, every clip is checked by a person before delivery, and only clips scoring 90+ go out."),
      p("Plans start at $500 a month for 20 posted clips. Before you pay anything, I'll send you 3 free clips from your latest stream or episode so you can judge for yourself."),
      btn("https://takekash.com", "Get my 3 free clips"), p("GtaxZombies")) },
  ] },
];

module.exports = { SEQUENCES };
