# Shell Integration: Making Karl Native

*"The best tools disappear into your workflow."*

This document outlines deep shell integration for Karl, making it feel like a native part of your terminal experience rather than a bolted-on tool.

## Philosophy

Karl should be:
- **Invisible until needed**: No performance overhead, instant when invoked
- **Context-aware**: Knows your current directory, last command, exit codes
- **Unobtrusive**: Integrates with existing workflows, doesn't replace them
- **Fast**: Keybindings beat typing, muscle memory beats thinking

## Core Keybindings

### Zsh/Bash Universal Bindings

```zsh
# Ctrl+K: Open Karl prompt
bindkey '^k' karl-prompt

# Ctrl+K Ctrl+E: Explain last command
bindkey '^k^e' karl-explain-last

# Ctrl+K Ctrl+F: Fix last command
bindkey '^k^f' karl-fix-last

# Ctrl+K Ctrl+X: Execute suggested fix immediately
bindkey '^k^x' karl-fix-and-run

# Ctrl+K Ctrl+H: Show command history analysis
bindkey '^k^h' karl-analyze-history

# Esc+K: Karl suggestion on current buffer
bindkey '\ek' karl-suggest-current
```

### Context Menu Integration

```zsh
# When a command fails:
# Right-click → "Ask Karl" → Opens karl with error context

# After any command:
# Ctrl+K Ctrl+W: "Why did this succeed/fail?"
bindkey '^k^w' karl-explain-result
```

## Plugin Architecture

### Zsh Plugin (`~/.oh-my-zsh/custom/plugins/karl/karl.plugin.zsh`)

```zsh
#!/usr/bin/env zsh
# Karl - AI assistant for your shell
# Named after Ivo Karlović, the ace master 🎾

# ============================================================================
# Configuration
# ============================================================================

export KARL_SHELL_INTEGRATION=1
export KARL_KEYBIND_PREFIX="^k"  # Ctrl+K
export KARL_AUTO_SUGGEST=${KARL_AUTO_SUGGEST:-0}  # Disabled by default
export KARL_INLINE_ERRORS=${KARL_INLINE_ERRORS:-1}  # Enabled by default
export KARL_HISTORY_SIZE=${KARL_HISTORY_SIZE:-10}  # Commands to include

# ============================================================================
# State Tracking
# ============================================================================

typeset -g KARL_LAST_COMMAND=""
typeset -g KARL_LAST_EXIT_CODE=0
typeset -g KARL_LAST_OUTPUT=""
typeset -g KARL_CWD="$PWD"

# Capture command execution
karl_preexec() {
    KARL_LAST_COMMAND="$1"
    KARL_CWD="$PWD"
}

karl_precmd() {
    KARL_LAST_EXIT_CODE=$?
    
    # Update prompt indicator if enabled
    if [[ $KARL_PROMPT_INDICATOR == 1 ]]; then
        karl_update_prompt
    fi
    
    # Auto-suggest on error if enabled
    if [[ $KARL_LAST_EXIT_CODE -ne 0 ]] && [[ $KARL_AUTO_SUGGEST -eq 1 ]]; then
        karl_auto_suggest_fix
    fi
}

add-zsh-hook preexec karl_preexec
add-zsh-hook precmd karl_precmd

# ============================================================================
# Core Functions
# ============================================================================

# Open Karl prompt in overlay mode
karl-prompt() {
    local context_file=$(mktemp)
    
    # Build context
    {
        echo "# Current Context"
        echo "Directory: $PWD"
        echo "Last Command: $KARL_LAST_COMMAND"
        echo "Exit Code: $KARL_LAST_EXIT_CODE"
        echo ""
        echo "# Recent History"
        fc -ln -${KARL_HISTORY_SIZE} | sed 's/^/  /'
    } > "$context_file"
    
    # Read user input
    echo -n "🎾 Karl: "
    read -r karl_query
    
    if [[ -n "$karl_query" ]]; then
        karl --context "$context_file" "$karl_query"
    fi
    
    rm -f "$context_file"
    zle reset-prompt
}
zle -N karl-prompt

# Explain the last command
karl-explain-last() {
    if [[ -z "$KARL_LAST_COMMAND" ]]; then
        echo "🎾 No previous command to explain"
        zle reset-prompt
        return
    fi
    
    echo "\n🎾 Explaining: $KARL_LAST_COMMAND"
    karl explain --command "$KARL_LAST_COMMAND" --exit-code "$KARL_LAST_EXIT_CODE"
    zle reset-prompt
}
zle -N karl-explain-last

# Fix the last command
karl-fix-last() {
    if [[ -z "$KARL_LAST_COMMAND" ]]; then
        echo "🎾 No previous command to fix"
        zle reset-prompt
        return
    fi
    
    echo "\n🎾 Analyzing error..."
    local fixed_cmd=$(karl fix --command "$KARL_LAST_COMMAND" \
                            --exit-code "$KARL_LAST_EXIT_CODE" \
                            --cwd "$KARL_CWD" \
                            --format raw)
    
    if [[ -n "$fixed_cmd" ]]; then
        # Put fixed command in buffer for user to review
        BUFFER="$fixed_cmd"
        CURSOR=${#BUFFER}
    fi
    
    zle reset-prompt
}
zle -N karl-fix-last

# Fix and execute immediately (dangerous but convenient)
karl-fix-and-run() {
    karl-fix-last
    if [[ -n "$BUFFER" ]]; then
        echo "\n🎾 Executing: $BUFFER"
        zle accept-line
    fi
}
zle -N karl-fix-and-run

# Suggest improvements for current buffer
karl-suggest-current() {
    if [[ -z "$BUFFER" ]]; then
        return
    fi
    
    local suggestion=$(karl improve --command "$BUFFER" --format raw)
    
    if [[ -n "$suggestion" ]] && [[ "$suggestion" != "$BUFFER" ]]; then
        echo "\n💡 Suggestion: $suggestion"
        echo -n "Accept? [y/N] "
        read -k 1 accept
        echo
        
        if [[ "$accept" =~ ^[Yy]$ ]]; then
            BUFFER="$suggestion"
            CURSOR=${#BUFFER}
        fi
    fi
    
    zle reset-prompt
}
zle -N karl-suggest-current

# Analyze command history for patterns
karl-analyze-history() {
    echo "\n🎾 Analyzing your shell history..."
    fc -ln -100 | karl analyze-history --insights
    zle reset-prompt
}
zle -N karl-analyze-history

# Explain why last command succeeded/failed
karl-explain-result() {
    if [[ -z "$KARL_LAST_COMMAND" ]]; then
        echo "🎾 No previous command"
        zle reset-prompt
        return
    fi
    
    local status="succeeded"
    [[ $KARL_LAST_EXIT_CODE -ne 0 ]] && status="failed"
    
    echo "\n🎾 Why did '$KARL_LAST_COMMAND' $status?"
    karl explain-result --command "$KARL_LAST_COMMAND" \
                        --exit-code "$KARL_LAST_EXIT_CODE" \
                        --cwd "$KARL_CWD"
    zle reset-prompt
}
zle -N karl-explain-result

# ============================================================================
# Auto-suggestion (inline)
# ============================================================================

karl_auto_suggest_fix() {
    if [[ -z "$KARL_LAST_COMMAND" ]]; then
        return
    fi
    
    echo "💡 Command failed. Press Ctrl+K Ctrl+F to fix, Ctrl+K Ctrl+E to explain"
}

# ============================================================================
# Prompt Integration
# ============================================================================

KARL_PROMPT_INDICATOR=${KARL_PROMPT_INDICATOR:-0}

karl_prompt_indicator() {
    if [[ $KARL_PROMPT_INDICATOR -eq 1 ]]; then
        echo "%F{cyan}🎾%f "
    fi
}

karl_update_prompt() {
    # Hook to refresh prompt with Karl status
    # Can show: active skill, model, or just indicator
    :
}

# Add to existing prompt (example)
# PROMPT='$(karl_prompt_indicator)'$PROMPT

# ============================================================================
# Helper Functions
# ============================================================================

# Quick access functions
alias kk='karl'
alias khelp='karl --help'
alias kfix='karl fix --command "$KARL_LAST_COMMAND"'
alias kexplain='karl explain --command "$KARL_LAST_COMMAND"'

# Pipe-friendly
alias k='karl'

# Skill shortcuts
kskill() { karl --skill "$1" "${@:2}"; }
kstack() { karl --stack "$1" "${@:2}"; }

# Command enhancement
explain() { karl explain --command "$*"; }
improve() { karl improve --command "$*"; }
debug() { karl debug --command "$*" --verbose; }

# Context-aware
kwhy() { karl "Why did this happen: $KARL_LAST_COMMAND (exit $KARL_LAST_EXIT_CODE)"; }
khow() { karl "How do I $*"; }
kdo() { karl "$*" --execute; }  # Generate and run

# ============================================================================
# Tab Completion
# ============================================================================

_karl_completion() {
    local -a skills stacks flags
    
    # Get available skills
    skills=(${(f)"$(karl --list-skills 2>/dev/null | tail -n +2)"})
    
    # Get available stacks
    stacks=(${(f)"$(karl --list-stacks 2>/dev/null | tail -n +2)"})
    
    # Common flags
    flags=(
        '--help:Show help'
        '--skill:Use a specific skill'
        '--stack:Use a specific stack'
        '--context:Add context file'
        '--verbose:Verbose output'
        '--execute:Execute the result'
        '--interactive:Interactive mode'
    )
    
    case $words[2] in
        --skill)
            _describe 'skills' skills
            ;;
        --stack)
            _describe 'stacks' stacks
            ;;
        *)
            _describe 'flags' flags
            _files  # Allow file arguments
            ;;
    esac
}

compdef _karl_completion karl kskill kstack

# ============================================================================
# Error Handling Integration
# ============================================================================

# Capture stderr for analysis
karl_error_handler() {
    if [[ $? -ne 0 ]]; then
        # Store last error output if available
        # This requires shell-specific magic
        :
    fi
}

# ============================================================================
# Advanced: Terminal Buffer Reading
# ============================================================================

# Read visible terminal output (requires tmux or terminal-specific tools)
karl_read_buffer() {
    if [[ -n "$TMUX" ]]; then
        # In tmux, capture pane content
        tmux capture-pane -p -S -50
    else
        # Fallback to history
        fc -ln -10
    fi
}

# Context-aware karl with terminal buffer
kbuffer() {
    local buffer=$(karl_read_buffer)
    echo "$buffer" | karl "$@" --context-stdin
}

# ============================================================================
# Workflow Functions
# ============================================================================

# Git workflows
kcommit() {
    git diff --cached | karl "Write a commit message for these changes" --skill git
}

kpr() {
    git diff main | karl "Generate a PR description" --skill git
}

# Debug workflows
kdebug() {
    # Run command, capture output, analyze on failure
    local output=$("$@" 2>&1)
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        echo "$output"
        echo "\n🎾 Analyzing error..."
        echo "$output" | karl "Why did this fail: $*" --context-stdin
    else
        echo "$output"
    fi
    
    return $exit_code
}

# Code review
kreview() {
    git diff "$1" | karl "Review this code for issues" --skill code-review
}

# Log analysis
klogs() {
    tail -100 "$1" | karl "Analyze these logs for errors" --skill debugging
}

# ============================================================================
# Session Management
# ============================================================================

# Start a Karl session (maintains context across commands)
ksession() {
    local session_id="karl-session-$$"
    export KARL_SESSION_ID="$session_id"
    mkdir -p ~/.karl/sessions
    
    echo "🎾 Started Karl session: $session_id"
    echo "All karl calls will share context. Use 'ksession-end' to close."
}

ksession-end() {
    if [[ -n "$KARL_SESSION_ID" ]]; then
        echo "🎾 Ended session: $KARL_SESSION_ID"
        unset KARL_SESSION_ID
    fi
}

# ============================================================================
# Initialization
# ============================================================================

# Check if karl is available
if ! command -v karl &> /dev/null; then
    echo "⚠️  Karl not found in PATH. Shell integration disabled."
    return 1
fi

# Print welcome message (only on interactive shells)
if [[ -o interactive ]] && [[ -z "$KARL_INIT_SILENT" ]]; then
    echo "🎾 Karl shell integration loaded. Press Ctrl+K for assistance."
fi
```

### Bash Plugin (`~/.bash_karl.sh`)

```bash
#!/usr/bin/env bash
# Karl shell integration for Bash

export KARL_SHELL_INTEGRATION=1
export KARL_LAST_COMMAND=""
export KARL_LAST_EXIT_CODE=0

# Capture commands
_karl_preexec() {
    KARL_LAST_COMMAND="$BASH_COMMAND"
}

_karl_precmd() {
    KARL_LAST_EXIT_CODE=$?
}

trap '_karl_preexec' DEBUG
PROMPT_COMMAND="_karl_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"

# Keybindings (Bash uses readline)
bind '"\C-k": "\C-ukarl-prompt\C-m"'
bind '"\C-k\C-e": "\C-ukarl explain --command \"$KARL_LAST_COMMAND\"\C-m"'
bind '"\C-k\C-f": "\C-ukarl-fix-last\C-m"'

# Helper functions (similar to zsh version)
karl-fix-last() {
    if [[ -z "$KARL_LAST_COMMAND" ]]; then
        echo "🎾 No previous command to fix"
        return
    fi
    
    fixed=$(karl fix --command "$KARL_LAST_COMMAND" --exit-code "$KARL_LAST_EXIT_CODE" --format raw)
    if [[ -n "$fixed" ]]; then
        history -s "$fixed"  # Add to history
        echo "$fixed"
    fi
}

# Aliases
alias kk='karl'
alias kfix='karl-fix-last'
alias kexplain='karl explain --command "$KARL_LAST_COMMAND"'

# Tab completion
_karl_completions() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    
    case "$prev" in
        --skill)
            COMPREPLY=($(compgen -W "$(karl --list-skills 2>/dev/null | tail -n +2)" -- "$cur"))
            ;;
        --stack)
            COMPREPLY=($(compgen -W "$(karl --list-stacks 2>/dev/null | tail -n +2)" -- "$cur"))
            ;;
        *)
            COMPREPLY=($(compgen -W "--skill --stack --help --verbose --context" -- "$cur"))
            ;;
    esac
}

complete -F _karl_completions karl kk kskill kstack
```

### Fish Plugin (`~/.config/fish/conf.d/karl.fish`)

```fish
#!/usr/bin/env fish
# Karl shell integration for Fish

set -g KARL_SHELL_INTEGRATION 1
set -g KARL_LAST_COMMAND ""
set -g KARL_LAST_EXIT_CODE 0

# Event handlers
function __karl_preexec --on-event fish_preexec
    set -g KARL_LAST_COMMAND $argv[1]
end

function __karl_precmd --on-event fish_prompt
    set -g KARL_LAST_EXIT_CODE $status
end

# Keybindings
function fish_user_key_bindings
    bind \ck 'karl-prompt'
    bind \ck\ce 'karl-explain-last'
    bind \ck\cf 'karl-fix-last'
end

# Functions
function karl-prompt
    echo -n "🎾 Karl: "
    read -l query
    
    if test -n "$query"
        karl $query
    end
    
    commandline -f repaint
end

function karl-explain-last
    if test -z "$KARL_LAST_COMMAND"
        echo "🎾 No previous command"
        return
    end
    
    karl explain --command "$KARL_LAST_COMMAND" --exit-code "$KARL_LAST_EXIT_CODE"
    commandline -f repaint
end

function karl-fix-last
    if test -z "$KARL_LAST_COMMAND"
        echo "🎾 No previous command"
        return
    end
    
    set fixed (karl fix --command "$KARL_LAST_COMMAND" --exit-code "$KARL_LAST_EXIT_CODE" --format raw)
    
    if test -n "$fixed"
        commandline -r "$fixed"
    end
end

# Abbreviations (Fish's smart aliases)
abbr -a kk karl
abbr -a kfix karl-fix-last
abbr -a kexplain karl-explain-last

# Completions
complete -c karl -l skill -d "Use specific skill" -a "(karl --list-skills 2>/dev/null | tail -n +2)"
complete -c karl -l stack -d "Use specific stack" -a "(karl --list-stacks 2>/dev/null | tail -n +2)"
complete -c karl -l help -d "Show help"
complete -c karl -l verbose -d "Verbose output"
complete -c karl -l context -d "Add context file" -r

echo "🎾 Karl shell integration loaded"
```

## Terminal Buffer Integration

### Reading Terminal History

```zsh
# Advanced: Read actual terminal output (not just history)

# For terminals that support OSC 52 (clipboard)
karl_read_visible_output() {
    # Capture last N lines visible on screen
    local lines=${1:-20}
    
    if [[ -n "$TMUX" ]]; then
        # Tmux can capture pane content
        tmux capture-pane -p -S -$lines
    elif [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
        # iTerm2 specific
        # Use shell integration to get recent output
        echo "$_iterm2_last_output"
    else
        # Fallback: use command history
        fc -ln -$lines
    fi
}

# Send visible output to Karl
kcontext() {
    karl_read_visible_output | karl "$@" --context-stdin
}
```

### Error Context Capture

```zsh
# Automatically capture error output
typeset -g KARL_ERROR_LOG=""

karl_capture_errors() {
    # Override command execution to capture stderr
    exec 2> >(tee -a >(tail -100 > /tmp/karl-errors-$$))
}

# On error, analyze immediately
karl_on_error() {
    if [[ $KARL_LAST_EXIT_CODE -ne 0 ]]; then
        local error_context=$(tail -20 /tmp/karl-errors-$$)
        
        echo "\n🎾 Error detected. Analyzing..."
        echo "$error_context" | karl "Explain this error from: $KARL_LAST_COMMAND" \
            --context-stdin --quick
    fi
}

# Enable with: KARL_AUTO_ERROR=1
[[ $KARL_AUTO_ERROR -eq 1 ]] && add-zsh-hook precmd karl_on_error
```

## Inline AI Suggestions

### Zsh Autosuggestions Integration

```zsh
# Karl-powered autosuggestions (alternative to zsh-autosuggestions)

typeset -g KARL_SUGGESTION_CACHE=""

karl_autosuggest_strategy() {
    local buffer="$1"
    
    # Only suggest if buffer is substantial
    if [[ ${#buffer} -lt 5 ]]; then
        return
    fi
    
    # Check cache first
    local cache_key=$(echo "$buffer" | md5sum | cut -d' ' -f1)
    local cache_file=~/.karl/cache/suggestions/$cache_key
    
    if [[ -f "$cache_file" ]] && [[ $(find "$cache_file" -mmin -60) ]]; then
        # Use cached suggestion (less than 1 hour old)
        cat "$cache_file"
    else
        # Generate new suggestion (async to not block)
        {
            local suggestion=$(karl autocomplete --buffer "$buffer" \
                                                --history "$(fc -ln -5)" \
                                                --format raw \
                                                --quick)
            
            if [[ -n "$suggestion" ]] && [[ "$suggestion" != "$buffer" ]]; then
                mkdir -p ~/.karl/cache/suggestions
                echo "$suggestion" > "$cache_file"
                
                # Signal to update suggestion
                kill -USR1 $$
            fi
        } &!
    fi
}

# Integration point
ZSH_AUTOSUGGEST_STRATEGY=(karl_autosuggest_strategy)
```

### Command Completion Enhancement

```zsh
# Enhance tab completion with AI suggestions

karl_completion_enhance() {
    local current_word="$1"
    local full_buffer="$2"
    
    # Standard completion first
    local std_completions=("${(@f)$(compgen -c "$current_word")}")
    
    # Add Karl suggestions
    local karl_completions=("${(@f)$(karl suggest-completion \
        --buffer "$full_buffer" \
        --word "$current_word" \
        --format list)}")
    
    # Merge and deduplicate
    local all_completions=("${std_completions[@]}" "${karl_completions[@]}")
    printf '%s\n' "${all_completions[@]}" | sort -u
}
```

## Prompt Integration (PS1)

### Zsh Prompt Examples

```zsh
# Minimal: Just indicator when Karl is active
PROMPT='$(karl_prompt_indicator)%~ %# '

# With model info
karl_prompt_indicator() {
    if [[ -n "$KARL_SESSION_ID" ]]; then
        local model=$(karl current-model 2>/dev/null || echo "haiku")
        echo "%F{cyan}🎾[$model]%f "
    fi
}

# With skill indicator
karl_prompt_skill() {
    if [[ -n "$KARL_ACTIVE_SKILL" ]]; then
        echo "%F{yellow}[$KARL_ACTIVE_SKILL]%f "
    fi
}

# Full integration
PROMPT='$(karl_prompt_indicator)$(karl_prompt_skill)%F{blue}%~%f %# '

# Right prompt with stats
RPROMPT='$(karl_prompt_stats)'

karl_prompt_stats() {
    if [[ -f ~/.karl/stats/daily.json ]]; then
        local aces=$(jq -r '.aces_today' ~/.karl/stats/daily.json)
        echo "%F{green}⚡$aces%f"
    fi
}
```

### Bash Prompt

```bash
# Add Karl indicator to PS1
karl_prompt() {
    if [[ -n "$KARL_SESSION_ID" ]]; then
        echo "🎾 "
    fi
}

PS1='$(karl_prompt)\u@\h:\w\$ '
```

### Fish Prompt

```fish
function fish_prompt
    # Karl indicator
    if set -q KARL_SESSION_ID
        set_color cyan
        echo -n "🎾 "
        set_color normal
    end
    
    # Standard prompt
    set_color blue
    echo -n (prompt_pwd)
    set_color normal
    echo -n ' > '
end
```

## Example Configuration Files

### Complete `.zshrc` Integration

```zsh
# ~/.zshrc

# ... your existing config ...

# ============================================================================
# Karl Integration
# ============================================================================

# Load Karl plugin
source ~/.oh-my-zsh/custom/plugins/karl/karl.plugin.zsh

# Or if not using oh-my-zsh:
# source ~/.zsh/karl.zsh

# Configuration
export KARL_AUTO_SUGGEST=1        # Enable inline suggestions
export KARL_INLINE_ERRORS=1       # Show error hints
export KARL_PROMPT_INDICATOR=1    # Show in prompt
export KARL_HISTORY_SIZE=10       # Context size

# Default model (override with --stack)
export KARL_DEFAULT_STACK="cliffy"  # Fast for most tasks

# Keybinding preference (if you use Ctrl+K for something else)
# export KARL_KEYBIND_PREFIX="^]"  # Ctrl+]

# Custom workflows
alias gk='git diff | karl "Review these changes"'
alias tk='tmux capture-pane -p | karl --context-stdin'
alias dk='docker logs --tail 100 | karl "Analyze these logs"'

# Quick questions
how() { karl "How do I $*"; }
what() { karl "What is $*"; }
why() { karl "Why does $*"; }

# Prompt customization
PROMPT='$(karl_prompt_indicator)%F{green}%n@%m%f %F{blue}%~%f %# '
RPROMPT='$(karl_prompt_stats)'

# ============================================================================
# Advanced: Project-specific Karl config
# ============================================================================

# Auto-load .karlrc from current directory
karl_load_project_config() {
    if [[ -f .karlrc ]]; then
        source .karlrc
    fi
}

add-zsh-hook chpwd karl_load_project_config

# Example .karlrc in a Python project:
# export KARL_ACTIVE_SKILL="python"
# alias ktest='karl "Write tests for" --context $(git diff)'
```

### Minimal `.zshrc` (Just the essentials)

```zsh
# Minimal Karl integration - just the basics

# Load plugin
source ~/.zsh/karl.zsh

# Core keybinding
bindkey '^k' karl-prompt

# Quick aliases
alias k='karl'
alias kfix='karl fix --command "$KARL_LAST_COMMAND"'
```

### `.bashrc` Integration

```bash
# ~/.bashrc

# Karl integration
source ~/.bash_karl.sh

# Quick helpers
export KARL_DEFAULT_STACK="cliffy"

# Prompt
PS1='🎾 \u@\h:\w\$ '

# Workflows
alias gk='git diff | karl "Review"'
```

## Making It Feel Native

### Design Principles

1. **Zero Latency for Keybindings**
   - Keybindings should respond instantly
   - Heavy work happens after keypress
   - Use async/background jobs for suggestions

2. **Respect Shell Conventions**
   - Don't override common keybindings without user consent
   - Use standard completion mechanisms
   - Follow shell's configuration patterns

3. **Progressive Enhancement**
   - Works great with just `karl` in PATH
   - Better with plugin loaded
   - Best with full integration

4. **Context is King**
   - Always know: current directory, last command, exit code
   - Optional: visible terminal output, recent history
   - Never: store sensitive data in context

5. **Fail Gracefully**
   - If karl binary not found: silent degradation
   - If API fails: show error, don't break shell
   - If slow: show progress, allow cancellation

### Performance Optimization

```zsh
# Cache expensive operations
typeset -A KARL_CACHE

karl_cached_call() {
    local key="$1"
    local ttl=${2:-300}  # 5 minutes default
    local cache_file=~/.karl/cache/$key
    
    if [[ -f "$cache_file" ]] && [[ $(find "$cache_file" -mtime -${ttl}s) ]]; then
        cat "$cache_file"
    else
        local result=$("${@:3}")
        echo "$result" | tee "$cache_file"
    fi
}

# Example: Cache skill list
_karl_get_skills() {
    karl_cached_call "skills" 3600 karl --list-skills
}
```

### Visual Consistency

```zsh
# Consistent branding
export KARL_EMOJI="🎾"
export KARL_COLOR="cyan"

karl_echo() {
    echo "%F{$KARL_COLOR}$KARL_EMOJI%f $*"
}

# Use throughout integration
karl-prompt() {
    karl_echo "What can I help with?"
    # ...
}
```

### Error Handling Best Practices

```zsh
# Always handle missing binary
command -v karl &> /dev/null || {
    echo "⚠️  Karl not installed. Visit https://github.com/you/karl"
    return 1
}

# Handle API failures gracefully
karl_safe_call() {
    local output
    output=$(karl "$@" 2>&1)
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        echo "🎾 Karl error: $output" >&2
        return $exit_code
    fi
    
    echo "$output"
}

# Timeout protection
karl_with_timeout() {
    timeout 30s karl "$@" || {
        echo "🎾 Request timed out"
        return 124
    }
}
```

## Advanced Features

### Multi-command Analysis

```zsh
# Analyze a pipeline of commands
kpipe() {
    local cmd="$*"
    karl "Explain this pipeline: $cmd"
}

# Example: kpipe cat file.txt | grep error | wc -l
```

### Smart Context Windows

```zsh
# Different context sizes for different operations
karl_context_size() {
    case "$1" in
        explain|why) echo 5 ;;
        fix|improve) echo 10 ;;
        analyze) echo 50 ;;
        *) echo 10 ;;
    esac
}
```

### Session Persistence

```zsh
# Remember context across shell restarts
karl_save_session() {
    {
        echo "KARL_SESSION_ID=$KARL_SESSION_ID"
        echo "KARL_CWD=$PWD"
        echo "KARL_LAST_COMMAND=$KARL_LAST_COMMAND"
    } > ~/.karl/session-state
}

karl_restore_session() {
    [[ -f ~/.karl/session-state ]] && source ~/.karl/session-state
}

# On shell start
karl_restore_session

# On shell exit
trap karl_save_session EXIT
```

## Installation

### Quick Install

```bash
# Zsh (oh-my-zsh)
git clone https://github.com/you/karl ~/.oh-my-zsh/custom/plugins/karl
# Add 'karl' to plugins in ~/.zshrc

# Zsh (standalone)
curl -o ~/.zsh/karl.zsh https://raw.githubusercontent.com/you/karl/main/shell/karl.zsh
echo "source ~/.zsh/karl.zsh" >> ~/.zshrc

# Bash
curl -o ~/.bash_karl.sh https://raw.githubusercontent.com/you/karl/main/shell/karl.bash
echo "source ~/.bash_karl.sh" >> ~/.bashrc

# Fish
curl -o ~/.config/fish/conf.d/karl.fish https://raw.githubusercontent.com/you/karl/main/shell/karl.fish
```

### Verification

```bash
# Check integration is loaded
echo $KARL_SHELL_INTEGRATION  # Should output: 1

# Test keybinding (press Ctrl+K, should show prompt)

# Test completion
karl --sk<TAB>  # Should complete to --skill

# Test functions
kk --help
```

## Troubleshooting

### Keybindings not working

```zsh
# Check what Ctrl+K is bound to
bindkey | grep '\\^K'

# Rebind if needed
bindkey '^k' karl-prompt
```

### Slow completions

```zsh
# Disable Karl completions temporarily
unset KARL_AUTO_SUGGEST

# Or increase cache time
export KARL_CACHE_TTL=3600  # 1 hour
```

### Context not captured

```zsh
# Verify hooks are loaded
echo $precmd_functions | grep karl  # Should see karl_precmd
echo $preexec_functions | grep karl  # Should see karl_preexec

# Reload hooks
add-zsh-hook precmd karl_precmd
add-zsh-hook preexec karl_preexec
```

---

## Philosophy Check

✅ **Fast**: Keybindings are instant, heavy work is async  
✅ **Unobtrusive**: Works with existing workflow, doesn't replace it  
✅ **Context-aware**: Always knows what you're doing  
✅ **Native-feeling**: Follows shell conventions  
✅ **Progressive**: Basic → Good → Great experience levels  

*"Ace on first serve. The shell should disappear, Karl should appear exactly when needed."* 🎾
