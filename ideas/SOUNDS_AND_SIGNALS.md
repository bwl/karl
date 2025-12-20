# Sounds and Signals 🔔

> Terminal feedback that's tasteful, accessible, and optional

Karl is fast—sometimes *too* fast. You submit a serve, context switch to Slack, and miss the ace. This document explores audio, visual, and haptic feedback to keep you in the game without being annoying.

## Philosophy

**Rule #1: Silence by default, signal by choice**

- Most operations complete instantly—no need for fanfare
- Long-running tasks deserve completion notifications
- Failed aces deserve a different sound than successful ones
- Everything must be disableable
- Accessibility first, aesthetics second

---

## 1. Terminal Bell Strategies

### The Classic Bell (`\x07`)

```bash
# Simple completion bell
karl serve --bell
```

**Implementation:**
```typescript
function ringBell() {
  if (config.audio.bell) {
    process.stdout.write('\x07');
  }
}
```

### Smart Bell Threshold

Only ring for operations exceeding a time threshold:

```bash
# Bell only if task takes >5 seconds
karl serve --bell-threshold=5s
```

**Use cases:**
- Long file analysis
- Multi-file operations
- Volley batches with >10 tasks
- Stack operations that compile/build

---

## 2. Differentiated Audio Feedback

### Terminal Color Bell (modern terminals)

Some terminals (iTerm2, Kitty, WezTerm) support custom bell sounds:

```bash
# Success: high tone
echo -e "\x1b]1337;SetBadgeFormat=$(echo -n "✓" | base64)\x07"

# Failure: low tone  
echo -e "\x1b]1337;SetBadgeFormat=$(echo -n "✗" | base64)\x07"
```

### OSC 777 Notification Protocol

```bash
# Send structured notification
printf "\x1b]777;notify;%s;%s\x07" "Karl" "Serve complete: 847 tokens"
```

### ASCII Bell Variations

For terminals that don't support tones, use repeated bells:

```typescript
const bellPatterns = {
  success: '\x07',           // Single bell
  failure: '\x07\x07',       // Double bell (200ms apart)
  warning: '\x07',           // Single bell
  info: '',                  // No bell
};
```

---

## 3. Desktop Notifications

### Platform Detection

```typescript
const notifiers = {
  darwin: 'osascript',      // macOS
  linux: 'notify-send',     // Linux (libnotify)
  win32: 'powershell',      // Windows Toast
};

async function notify(title: string, message: string, type: 'success' | 'error' | 'info') {
  if (!config.notifications.desktop) return;
  
  const platform = process.platform;
  const threshold = config.notifications.threshold || 5000; // 5s default
  
  if (elapsed < threshold) return; // Don't notify for fast tasks
  
  switch (platform) {
    case 'darwin':
      await exec(`osascript -e 'display notification "${message}" with title "Karl 🎾" subtitle "${title}"'`);
      break;
    case 'linux':
      const icon = type === 'success' ? 'emblem-default' : 'dialog-error';
      await exec(`notify-send -i ${icon} "Karl: ${title}" "${message}"`);
      break;
    case 'win32':
      // Windows Toast notification
      await exec(`powershell -Command "New-BurntToastNotification -Text 'Karl', '${title}', '${message}'"`);
      break;
  }
}
```

### Integration Points

```bash
# Explicit notification request
karl serve --notify "Analyze entire codebase"

# Auto-notify on long operations
karl volley --jobs=50 --notify-when-done

# Notify on failure only
karl serve --notify-on-error
```

### Notification Content Examples

**Success:**
```
🎾 Karl: Ace!
Served 3 files, 1,247 tokens
Model: claude-sonnet-4
Duration: 8.3s
```

**Failure:**
```
⚠️ Karl: Fault
API rate limit exceeded
Retry in 30s
```

**Volley Complete:**
```
🎾 Karl: Volley Complete
12/12 tasks finished
3 aces, 9 rallies
Total: 2m 15s
```

---

## 4. tmux/screen Integration

### Status Line Updates

```bash
# Update tmux status with current Karl operation
tmux set -g status-right "Karl: serving... #[fg=yellow]●"
tmux set -g status-right "Karl: complete #[fg=green]✓"
```

### Implementation

```typescript
function updateTmuxStatus(status: string, icon: string) {
  if (!process.env.TMUX) return;
  
  const colors = {
    running: 'yellow',
    success: 'green',
    failure: 'red',
    idle: 'blue',
  };
  
  exec(`tmux set -g status-right "Karl ${icon} #[fg=${colors[status]}]${status}"`);
}
```

### Window Titles

```typescript
function setTerminalTitle(title: string) {
  // Works in most modern terminals
  process.stdout.write(`\x1b]0;${title}\x07`);
}

// Usage
setTerminalTitle('Karl: Serving 3 files...');
setTerminalTitle('Karl: Ace! ✓');
```

### tmux Bells

```bash
# Trigger visual bell in tmux (highlighted status)
tmux display-message "Karl: Task complete"

# With color
tmux display-message -d 2000 "#[bg=green,fg=black] Karl: Ace! "
```

---

## 5. Progress Bar Aesthetics

### Minimalist Spinner

```
⠋ Serving...
⠙ Serving...
⠹ Serving...
⠸ Serving...
⠼ Serving...
⠴ Serving...
⠦ Serving...
⠧ Serving...
⠇ Serving...
⠏ Serving...
```

### Tennis-Themed Spinners

```
🎾 Serving...
🎾 Serving...
🏸 Serving...  # (mix it up)
```

Or court-based:

```
[       🎾      ] Serving...
[      🎾       ] Serving...
[     🎾        ] Serving...
```

### Progress Bars with Personality

**Ace Counter:**
```
Aces: ▓▓▓▓▓░░░░░ 5/10 files
```

**Court Layout:**
```
━━━━━━━╋━━━━━━━  Serving file 3/7
Player ━━━━━━━━━→ 🎾
```

**Token Counter:**
```
Tokens: [████████░░] 847/1000 (84%)
```

### Streaming Response Indicator

```
╭─ Streaming response
│ ████████████████░░░░ 847 tokens
│ ⚡ 42 tok/s
╰─ Ctrl+C to stop
```

---

## 6. Haptic Feedback

### Supported Terminals

Very few terminals support haptics, but some do:

**Kitty Graphics Protocol:**
```bash
# Vibration pattern (if hardware supports)
printf '\x1b_Gv=1,d=100\x1b\\'
```

**iOS Terminal Apps:**
Many SSH clients on iOS/Android support haptic feedback via custom escape codes.

### Implementation

```typescript
function hapticFeedback(pattern: 'success' | 'error' | 'warning') {
  if (!config.haptics.enabled) return;
  
  const patterns = {
    success: '\x1b_Gv=1,d=50\x1b\\',   // Short pulse
    error: '\x1b_Gv=2,d=100\x1b\\',    // Double pulse
    warning: '\x1b_Gv=1,d=200\x1b\\',  // Long pulse
  };
  
  process.stdout.write(patterns[pattern]);
}
```

**Note:** This is highly experimental and not recommended for general use.

---

## 7. Sound Modes

### Configuration Levels

```yaml
# ~/.config/karl/config.yaml
audio:
  mode: normal  # silent | normal | verbose
  
  bell:
    enabled: true
    threshold: 5  # seconds
    
  notifications:
    desktop: true
    threshold: 10  # seconds
    on_error_only: false
    
  tmux:
    status_updates: true
    window_title: true
    
  progress:
    style: minimal  # minimal | tennis | verbose
    spinner: dots   # dots | tennis | braille
    
  haptics:
    enabled: false  # experimental
```

### Mode Behaviors

**Silent Mode:**
```bash
karl serve --silent
# - No bell
# - No desktop notifications
# - No tmux status updates
# - Progress bars only (no spinners)
# - Exit codes still work
```

**Normal Mode (default):**
```bash
karl serve
# - Bell on long tasks (>5s)
# - Desktop notifications on very long tasks (>10s)
# - tmux status updates
# - Minimalist progress indicators
```

**Verbose Mode:**
```bash
karl serve --verbose
# - Bell on all completions
# - Desktop notifications always
# - Detailed progress bars
# - Token counters
# - Timing information
# - Model/cost details
```

---

## 8. System Notification Centers

### macOS Notification Center

```bash
osascript -e 'display notification "Serve complete" with title "Karl 🎾"'

# With sound
osascript -e 'display notification "Serve complete" with title "Karl" sound name "Glass"'

# Available sounds: Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink
```

### Linux (notify-send)

```bash
notify-send "Karl 🎾" "Serve complete" \
  --icon=emblem-default \
  --urgency=low \
  --expire-time=5000

# With custom icon
notify-send "Karl" "Task failed" \
  --icon=/usr/share/icons/karl-icon.png \
  --urgency=critical
```

### Windows Toast Notifications

```powershell
New-BurntToastNotification -Text "Karl", "Serve complete", "847 tokens in 8.3s" -AppLogo "C:\icons\karl.png"
```

### D-Bus Integration (Linux)

For more control on Linux:

```typescript
import { DBus } from 'dbus-next';

async function notifyDBus(title: string, body: string) {
  const bus = DBus.sessionBus();
  const obj = await bus.getProxyObject('org.freedesktop.Notifications', 
                                       '/org/freedesktop/Notifications');
  const notifications = obj.getInterface('org.freedesktop.Notifications');
  
  await notifications.Notify(
    'Karl',           // app_name
    0,                // replaces_id
    'karl-icon',      // app_icon
    title,            // summary
    body,             // body
    [],               // actions
    {},               // hints
    5000              // expire_timeout
  );
}
```

---

## 9. Accessibility Considerations

### Screen Reader Support

**ARIA-like Announcements:**
```typescript
function announce(message: string, priority: 'polite' | 'assertive' = 'polite') {
  if (!config.accessibility.screenReader) return;
  
  // Use OSC 777 for screen reader hints
  process.stdout.write(`\x1b]777;announce;${priority};${message}\x07`);
}

// Usage
announce("Serve complete, 3 files processed", "polite");
announce("Error: API rate limit exceeded", "assertive");
```

### Visual Alternatives to Sound

For deaf/hard-of-hearing users:

```bash
# Flash screen instead of bell
printf '\x1b[?5h'  # Enable reverse video
sleep 0.1
printf '\x1b[?5l'  # Disable reverse video
```

### High Contrast Mode

```typescript
const a11yColors = {
  success: '\x1b[30;102m',  // Black on bright green
  error: '\x1b[30;101m',    // Black on bright red
  warning: '\x1b[30;103m',  // Black on bright yellow
  info: '\x1b[30;104m',     // Black on bright blue
};
```

### Configurable Notification Duration

```yaml
accessibility:
  screen_reader: false
  visual_bell: true  # Flash instead of beep
  notification_duration: 10  # seconds (longer than default)
  high_contrast: false
  reduce_motion: false  # Disable spinners/animations
```

---

## 10. Examples of Tasteful Feedback

### Example 1: Quick Serve (1.2s)

```bash
$ karl serve main.ts --bell
```

**Output:**
```
⠋ Serving main.ts...
✓ Ace! main.ts (1.2s, 342 tokens)
```

**Feedback:**
- No bell (under threshold)
- No notification
- Simple checkmark and timing

---

### Example 2: Long Analysis (12s)

```bash
$ karl serve --all
```

**Output:**
```
⠋ Serving 47 files...
⠙ Analyzing... 12/47 files
⠹ Analyzing... 31/47 files
✓ Complete! 47 files (12.3s, 8,942 tokens)
🔔
```

**Feedback:**
- Terminal bell (over 5s threshold)
- Desktop notification: "Karl: Ace! 47 files analyzed (12.3s)"
- tmux status: `Karl ✓ complete`

---

### Example 3: Volley with Failures

```bash
$ karl volley --jobs=10 --notify
```

**Output:**
```
━━━━━━━╋━━━━━━━ Volley: 10 tasks
⠋ Running 5 parallel...
✓ task-1 (ace)
✓ task-2 (ace)
✗ task-3 (fault: timeout)
✓ task-4 (ace)
✓ task-5 (ace)

━━━━━━━╋━━━━━━━ Volley Complete
8/10 aces, 2 faults
Duration: 2m 15s
🔔🔔
```

**Feedback:**
- Double bell (failures detected)
- Desktop notification: "Karl: Volley Complete - 8/10 tasks succeeded"
- Red badge in tmux status

---

### Example 4: Silent Background Job

```bash
$ karl serve --silent background-job.ts &
```

**Output:**
```
✓ background-job.ts (3.4s)
```

**Feedback:**
- No bell
- No notification
- No tmux updates
- Minimal output (still logged)

---

### Example 5: Verbose Mode with Metrics

```bash
$ karl serve main.ts --verbose
```

**Output:**
```
╭─ Serving main.ts
│ Model: claude-sonnet-4
│ Context: 1,247 tokens
│ 
│ ⠋ Waiting for response...
│ ████████████████████ Streaming...
│ ⚡ 48 tok/s
│ 
│ ✓ Complete
│ 
│ Response: 342 tokens
│ Cost: $0.0023
│ Duration: 1.2s
╰─ Ace!
🔔
```

**Feedback:**
- Bell on completion
- Detailed token/cost metrics
- Streaming indicator
- Box drawing for clarity

---

## 11. Implementation Checklist

### Phase 1: Basic Bell Support
- [ ] Add `--bell` flag
- [ ] Implement time threshold
- [ ] Config file: `audio.bell.enabled` and `audio.bell.threshold`
- [ ] Exit with bell on completion

### Phase 2: Desktop Notifications
- [ ] Platform detection (macOS/Linux/Windows)
- [ ] `--notify` flag
- [ ] Notification threshold config
- [ ] Success/error differentiation
- [ ] Custom notification messages

### Phase 3: tmux/screen Integration
- [ ] Detect `$TMUX` environment
- [ ] Update status line during operations
- [ ] Set window titles
- [ ] tmux message on completion

### Phase 4: Progress Aesthetics
- [ ] Implement spinner variations
- [ ] Tennis-themed progress bars
- [ ] Token counter display
- [ ] Streaming response indicator

### Phase 5: Accessibility
- [ ] Visual bell (screen flash)
- [ ] Screen reader announcements
- [ ] High contrast mode
- [ ] Configurable durations
- [ ] `--reduce-motion` flag

### Phase 6: Sound Modes
- [ ] Silent mode
- [ ] Normal mode (default)
- [ ] Verbose mode
- [ ] Mode switching via flags and config

---

## 12. Configuration Examples

### Minimal Setup (Silent User)

```yaml
# ~/.config/karl/config.yaml
audio:
  mode: silent
```

### Power User (All Notifications)

```yaml
audio:
  mode: verbose
  bell:
    enabled: true
    threshold: 0  # Bell on every completion
  notifications:
    desktop: true
    threshold: 5
    on_error_only: false
  tmux:
    status_updates: true
    window_title: true
  progress:
    style: tennis
    spinner: tennis
```

### Accessibility Focus

```yaml
audio:
  mode: normal
accessibility:
  screen_reader: true
  visual_bell: true
  notification_duration: 15
  high_contrast: true
  reduce_motion: true
```

### Background Jobs

```yaml
audio:
  mode: silent
  notifications:
    desktop: true  # Only desktop notifications, no terminal bells
    threshold: 60  # Only notify tasks >1 minute
```

---

## 13. Anti-Patterns to Avoid

❌ **Don't:**
- Play sounds by default on every operation
- Use annoying/long sound effects
- Spam notifications for fast operations
- Ignore user's notification preferences
- Use terminal bells without threshold
- Block on notification delivery
- Make sounds un-disableable

✅ **Do:**
- Respect system "Do Not Disturb" mode
- Use time thresholds intelligently
- Provide silent mode
- Make all audio optional
- Use subtle, professional tones
- Test with screen readers
- Document all sound options

---

## 14. Future Ideas

### Smart Notification Batching

If running multiple volleys, batch notifications:

```
Karl: 3 volleys complete
- volley-1: 10/10 aces
- volley-2: 8/10 aces
- volley-3: 9/10 aces
Total duration: 5m 32s
```

### Adaptive Thresholds

Learn user patterns:

```typescript
// After 100 tasks, adjust threshold based on user behavior
// If user dismisses all notifications <10s, increase threshold
const adaptiveThreshold = calculateFromHistory(taskHistory);
```

### Integration with Focus Apps

```bash
# Don't notify if user is in "Focus" mode (macOS)
# Don't notify during active meeting (Google Calendar API)
# Don't notify during pomodoro session
```

### Custom Sound Packs

```yaml
audio:
  sound_pack: tennis  # tennis | minimal | retro | silent
```

With sounds like:
- `ace.wav` - Clean, quick chime
- `fault.wav` - Subtle error tone
- `volley-complete.wav` - Satisfying completion sound

---

## Conclusion

Audio and visual feedback should enhance the Karl experience, not distract from it. 

**Golden Rules:**
1. **Silent by default** for fast operations
2. **Notify intelligently** for long operations
3. **Accessible always** for all users
4. **Configurable everything**
5. **Tennis-themed** but professional

The ace is the goal—and when you land one, you should hear about it. 🎾

