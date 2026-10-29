# ribbon-light

A light-theme fork of **[ribbon](https://github.com/robonuggets/ribbon)** by Jay E ([RoboNuggets](https://robonuggets.com)): a Claude Code mod that shows, in one slim row above your prompt, how much usage you have left and whether your prompt cache is warm or cold.

All credit for the original idea and code goes to the original author. This fork changes the look and adds a keep-warm switch. It is not affiliated with or endorsed by RoboNuggets.

## What's different from the original

- **Light theme.** No dark band: the text follows your app's light or dark theme.
- **Always one row on desktop.** As the window narrows it drops detail instead of wrapping: first the word "left" and long reset times, then reset times, the robot and the cost. The cache card opens only when you click **Show**.
- **Slim bars** instead of dot rows, coloured by how much is **left**: green above 30%, amber 15–30%, red under 15% with a bold **LOW**.
- **Smaller** robot and WARM pill, and a plain Show/Hide.
- **Keep warm.** Click **WARM** (or the 🪵 beside it) and it turns to 🔥. While on, it re-reads the cached conversation about 8 minutes before the one-hour cache would expire, so the session stays warm, for example overnight. Click again to turn it off.

### Keep warm: what to know

- **Cost:** each ping is one cache read of the whole conversation (about a tenth of the normal input price) plus a one-word reply, roughly once an hour. If you come back to the session, that is cheaper than a cold start, which rebuilds the whole cache at twice the input price.
- **Safety:** it switches itself off after 12 hours. A failed ping shows a notice and retries after 5 minutes, not every minute.
- **Needs:** the app open and the computer awake (plugged in, lid open). Pings stop while it sleeps.
- The ping does not appear in your chat and does not change the conversation.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ribbon-light --marketplace jurgisgavenas/ribbon-light
```

Type `y` when it asks `Add marketplace?`, pick the **user** scope with Enter, then start a new session.

From a shell:

```
claude plugin install ribbon-light --marketplace jurgisgavenas/ribbon-light
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `jurgisgavenas/ribbon-light`, then **Add plugin**.

If you have the original `ribbon` installed, uninstall it first, or you will get two bands.

## Privacy

It reads only Claude Code's own usage and cache figures. It has no network, file or shell access. Keep-warm pings go through your own Claude session.

## License

MIT, same as the original. Original © 2026 Jay E | RoboNuggets; modifications © 2026 jurgisgavenas. See [LICENSE](LICENSE).

The drawings embed the [Outfit](https://github.com/Outfitio/Outfit-Fonts) font, under the SIL Open Font License 1.1.
