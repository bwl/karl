/**
 * Shell completion scripts for Karl CLI
 *
 * Usage:
 *   karl completions bash >> ~/.bashrc
 *   karl completions zsh >> ~/.zshrc
 *   karl completions fish > ~/.config/fish/completions/karl.fish
 */

// Built-in commands
const COMMANDS = [
  'run', 'ask', 'do', 'execute', 'exec',
  'continue', 'cont', 'followup', 'follow-up', 'chain',
  'init', 'setup',
  'providers', 'models', 'stacks', 'skills',
  'config',
  'info', 'status', 'history', 'logs', 'jobs',
  'previous', 'prev', 'last',
  'tldr', 'help',
  'agent', 'claude',
  'debugdesign', 'dd',
  'completions'
];

// Subcommands
const SUBCOMMANDS: Record<string, string[]> = {
  providers: ['list', 'add', 'remove', 'edit', 'login', 'logout'],
  models: ['list', 'add', 'remove', 'edit', 'default'],
  stacks: ['list', 'show', 'create', 'edit', 'set', 'remove'],
  skills: ['list', 'show', 'create', 'validate'],
  config: ['tui', 'show', 'edit', 'set'],
  jobs: ['clean'],
  history: ['list', 'show', 'clear'],
  completions: ['bash', 'zsh', 'fish'],
  debugdesign: ['realistic', 'stress', 'errors', 'all'],
  dd: ['realistic', 'stress', 'errors', 'all']
};

// Flags for run command (and stack-as-verb)
const RUN_FLAGS = [
  '--model', '-m',
  '--verbose', '-v', '--stream', '--progress',
  '--json', '-j',
  '--stats',
  '--timeout',
  '--skill',
  '--no-tools', '--notools', '--pure', '--reasoning',
  '--unrestricted',
  '--context',
  '--context-file',
  '--continue', '-c',
  '--parent', '--follow-up', '--followup', '--chain',
  '--tag',
  '--no-history',
  '--plain',
  '--visuals',
  '--background', '-bg', '--bg', '--detach',
  '--stack',
  '--dry-run',
  '--help', '-h'
];

// Global flags
const GLOBAL_FLAGS = ['--help', '-h', '--version'];

function generateBashCompletion(): string {
  return `# Karl CLI bash completion
# Add to ~/.bashrc or ~/.bash_completion

_karl_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="${COMMANDS.join(' ')}"
    local run_flags="${RUN_FLAGS.join(' ')}"
    local global_flags="${GLOBAL_FLAGS.join(' ')}"

    # Subcommands
    local providers_cmds="${SUBCOMMANDS.providers.join(' ')}"
    local models_cmds="${SUBCOMMANDS.models.join(' ')}"
    local stacks_cmds="${SUBCOMMANDS.stacks.join(' ')}"
    local skills_cmds="${SUBCOMMANDS.skills.join(' ')}"
    local jobs_cmds="${SUBCOMMANDS.jobs.join(' ')}"
    local completions_cmds="${SUBCOMMANDS.completions.join(' ')}"
    local debugdesign_cmds="${SUBCOMMANDS.debugdesign.join(' ')}"
    local config_cmds="${SUBCOMMANDS.config.join(' ')}"

    # Get dynamic completions
    local stacks models skills
    if command -v karl &>/dev/null; then
        stacks=$(karl stacks list --names 2>/dev/null || true)
        models=$(karl models list --names 2>/dev/null || true)
        skills=$(karl skills list --names 2>/dev/null || true)
    fi

    case "\${words[1]}" in
        providers)
            COMPREPLY=($(compgen -W "$providers_cmds" -- "$cur"))
            return
            ;;
        models)
            if [[ \${cword} -eq 2 ]]; then
                COMPREPLY=($(compgen -W "$models_cmds" -- "$cur"))
            elif [[ "\${words[2]}" == "default" || "\${words[2]}" == "remove" || "\${words[2]}" == "edit" ]]; then
                COMPREPLY=($(compgen -W "$models" -- "$cur"))
            fi
            return
            ;;
        config)
            COMPREPLY=($(compgen -W "$config_cmds" -- "$cur"))
            return
            ;;
        stacks)
            if [[ \${cword} -eq 2 ]]; then
                COMPREPLY=($(compgen -W "$stacks_cmds" -- "$cur"))
            elif [[ "\${words[2]}" =~ ^(show|edit|set|remove)$ ]]; then
                COMPREPLY=($(compgen -W "$stacks" -- "$cur"))
            fi
            return
            ;;
        skills)
            if [[ \${cword} -eq 2 ]]; then
                COMPREPLY=($(compgen -W "$skills_cmds" -- "$cur"))
            elif [[ "\${words[2]}" == "show" ]]; then
                COMPREPLY=($(compgen -W "$skills" -- "$cur"))
            fi
            return
            ;;
        jobs)
            COMPREPLY=($(compgen -W "$jobs_cmds" -- "$cur"))
            return
            ;;
        completions)
            COMPREPLY=($(compgen -W "$completions_cmds" -- "$cur"))
            return
            ;;
        debugdesign|dd)
            if [[ "$cur" == -* ]]; then
                COMPREPLY=($(compgen -W "--speed --verbose --plain --help" -- "$cur"))
            else
                COMPREPLY=($(compgen -W "$debugdesign_cmds" -- "$cur"))
            fi
            return
            ;;
        run|ask|do|execute|exec|continue|cont|followup|follow-up|chain)
            if [[ "$cur" == -* ]]; then
                COMPREPLY=($(compgen -W "$run_flags" -- "$cur"))
            elif [[ "$prev" == "--model" || "$prev" == "-m" ]]; then
                COMPREPLY=($(compgen -W "$models" -- "$cur"))
            elif [[ "$prev" == "--skill" ]]; then
                COMPREPLY=($(compgen -W "$skills" -- "$cur"))
            elif [[ "$prev" == "--stack" ]]; then
                COMPREPLY=($(compgen -W "$stacks" -- "$cur"))
            elif [[ "$prev" == "--visuals" ]]; then
                COMPREPLY=($(compgen -W "auto unicode ascii plain none" -- "$cur"))
            fi
            return
            ;;
    esac

    # First argument - commands or stacks
    if [[ \${cword} -eq 1 ]]; then
        if [[ "$cur" == -* ]]; then
            COMPREPLY=($(compgen -W "$global_flags" -- "$cur"))
        else
            COMPREPLY=($(compgen -W "$commands $stacks" -- "$cur"))
        fi
        return
    fi

    # Stack as verb - complete like run
    if [[ " $stacks " =~ " \${words[1]} " ]]; then
        if [[ "$cur" == -* ]]; then
            COMPREPLY=($(compgen -W "$run_flags" -- "$cur"))
        elif [[ "$prev" == "--model" || "$prev" == "-m" ]]; then
            COMPREPLY=($(compgen -W "$models" -- "$cur"))
        elif [[ "$prev" == "--skill" ]]; then
            COMPREPLY=($(compgen -W "$skills" -- "$cur"))
        fi
    fi
}

complete -F _karl_completions karl
`;
}

function generateZshCompletion(): string {
  return `#compdef karl
# Karl CLI zsh completion
# Add to ~/.zshrc or place in fpath

_karl() {
    local curcontext="$curcontext" state line
    typeset -A opt_args

    local commands=(
        ${COMMANDS.map(c => `'${c}:${getCommandDescription(c)}'`).join('\n        ')}
    )

    local run_flags=(
        '--model[Model alias or exact model id]:model:->models'
        '-m[Model alias]:model:->models'
        '--verbose[Stream thoughts and tool calls]'
        '-v[Verbose output]'
        '--stream[Stream output]'
        '--progress[Show progress]'
        '--json[JSON output]'
        '-j[JSON output]'
        '--stats[Print summary stats]'
        '--timeout[Per-task timeout]:timeout:'
        '--skill[Load a skill by name]:skill:->skills'
        '--no-tools[Disable tool use]'
        '--pure[Disable tool use]'
        '--reasoning[Disable tool use]'
        '--unrestricted[Allow writes outside working directory]'
        '--context[Extra system prompt text]:context:'
        '--context-file[Path to context file]:file:_files'
        '--continue[Chain from last run]'
        '-c[Chain from last run]'
        '--parent[Parent run id]:parent:'
        '--follow-up[Alias for --parent]:parent:'
        '--tag[Tag this run]:tag:'
        '--no-history[Disable history logging]'
        '--plain[ASCII-only output]'
        '--visuals[Visual mode]:mode:(auto unicode ascii plain none)'
        '--background[Run in background]'
        '-bg[Run in background]'
        '--stack[Use stack]:stack:->stacks'
        '--dry-run[Show config without running]'
        '--help[Show help]'
        '-h[Show help]'
    )

    _arguments -C \\
        '1: :->command' \\
        '*::arg:->args'

    case $state in
        command)
            # Get dynamic stacks
            local stacks
            stacks=(\${(f)"$(karl stacks list --names 2>/dev/null)"})
            _describe 'command' commands
            [[ -n "$stacks" ]] && _describe 'stack' stacks
            ;;
        args)
            case $words[1] in
                providers)
                    local -a subcmds=(
                        'list:List configured providers'
                        'add:Add a new provider'
                        'remove:Remove a provider'
                        'edit:Edit a provider file'
                        'login:Login to OAuth provider'
                        'logout:Logout from OAuth provider'
                    )
                    _describe 'subcommand' subcmds
                    ;;
                models)
                    local -a subcmds=(
                        'list:List configured models'
                        'add:Add a new model'
                        'remove:Remove a model'
                        'edit:Edit a model file'
                        'default:Set the default model'
                    )
                    if (( CURRENT == 2 )); then
                        _describe 'subcommand' subcmds
                    elif [[ $words[2] =~ ^(default|remove|edit)$ ]]; then
                        local models
                        models=(\${(f)"$(karl models list --names 2>/dev/null)"})
                        _describe 'model' models
                    fi
                    ;;
                config)
                    local -a subcmds=(
                        'tui:Launch config TUI'
                        'show:Show config JSON'
                        'edit:Edit config file'
                        'set:Update config fields'
                    )
                    _describe 'subcommand' subcmds
                    ;;
                stacks)
                    local -a subcmds=(
                        'list:List available stacks'
                        'show:Show stack details'
                        'create:Create a new stack'
                        'edit:Edit a stack'
                        'set:Update stack fields'
                        'remove:Remove a stack'
                    )
                    if (( CURRENT == 2 )); then
                        _describe 'subcommand' subcmds
                    elif [[ $words[2] =~ ^(show|edit|set|remove)$ ]]; then
                        local stacks
                        stacks=(\${(f)"$(karl stacks list --names 2>/dev/null)"})
                        _describe 'stack' stacks
                    fi
                    ;;
                skills)
                    local -a subcmds=(
                        'list:List available skills'
                        'show:Show skill details'
                        'create:Create a new skill'
                        'validate:Validate a skill'
                    )
                    if (( CURRENT == 2 )); then
                        _describe 'subcommand' subcmds
                    elif [[ $words[2] == "show" ]]; then
                        local skills
                        skills=(\${(f)"$(karl skills list --names 2>/dev/null)"})
                        _describe 'skill' skills
                    fi
                    ;;
                jobs)
                    local -a subcmds=('clean:Cleanup old completed jobs')
                    _describe 'subcommand' subcmds
                    ;;
                completions)
                    local -a shells=('bash:Bash completion script' 'zsh:Zsh completion script' 'fish:Fish completion script')
                    _describe 'shell' shells
                    ;;
                debugdesign|dd)
                    local -a scenarios=('realistic:Coding session simulation' 'stress:Rapid-fire tool calls' 'errors:Error and recovery patterns' 'all:Run all scenarios')
                    _describe 'scenario' scenarios
                    _arguments $run_flags
                    ;;
                run|ask|do|execute|exec|continue|cont|followup|follow-up|chain|*)
                    _arguments $run_flags
                    ;;
            esac
            ;;
        models)
            local models
            models=(\${(f)"$(karl models list --names 2>/dev/null)"})
            _describe 'model' models
            ;;
        skills)
            local skills
            skills=(\${(f)"$(karl skills list --names 2>/dev/null)"})
            _describe 'skill' skills
            ;;
        stacks)
            local stacks
            stacks=(\${(f)"$(karl stacks list --names 2>/dev/null)"})
            _describe 'stack' stacks
            ;;
    esac
}

_karl "$@"
`;
}

function generateFishCompletion(): string {
  return `# Karl CLI fish completion
# Save to ~/.config/fish/completions/karl.fish

# Disable file completions by default
complete -c karl -f

# Helper function to get stacks
function __karl_stacks
    karl stacks list --names 2>/dev/null
end

# Helper function to get models
function __karl_models
    karl models list --names 2>/dev/null
end

# Helper function to get skills
function __karl_skills
    karl skills list --names 2>/dev/null
end

# Commands
${COMMANDS.map(c => `complete -c karl -n "__fish_use_subcommand" -a "${c}" -d "${getCommandDescription(c)}"`).join('\n')}

# Dynamic stack completions (stack-as-verb)
complete -c karl -n "__fish_use_subcommand" -a "(__karl_stacks)" -d "Run with stack"

# Global flags
complete -c karl -n "__fish_use_subcommand" -l help -s h -d "Show help"
complete -c karl -n "__fish_use_subcommand" -l version -d "Show version"

# providers subcommands
complete -c karl -n "__fish_seen_subcommand_from providers" -a "list" -d "List configured providers"
complete -c karl -n "__fish_seen_subcommand_from providers" -a "add" -d "Add a new provider"
complete -c karl -n "__fish_seen_subcommand_from providers" -a "remove" -d "Remove a provider"
complete -c karl -n "__fish_seen_subcommand_from providers" -a "edit" -d "Edit a provider file"
complete -c karl -n "__fish_seen_subcommand_from providers" -a "login" -d "Login to OAuth provider"
complete -c karl -n "__fish_seen_subcommand_from providers" -a "logout" -d "Logout from OAuth provider"

# models subcommands
complete -c karl -n "__fish_seen_subcommand_from models" -a "list" -d "List configured models"
complete -c karl -n "__fish_seen_subcommand_from models" -a "add" -d "Add a new model"
complete -c karl -n "__fish_seen_subcommand_from models" -a "remove" -d "Remove a model"
complete -c karl -n "__fish_seen_subcommand_from models" -a "edit" -d "Edit a model file"
complete -c karl -n "__fish_seen_subcommand_from models" -a "default" -d "Set the default model"

# stacks subcommands
complete -c karl -n "__fish_seen_subcommand_from stacks" -a "list" -d "List available stacks"
complete -c karl -n "__fish_seen_subcommand_from stacks" -a "show" -d "Show stack details"
complete -c karl -n "__fish_seen_subcommand_from stacks" -a "create" -d "Create a new stack"
complete -c karl -n "__fish_seen_subcommand_from stacks" -a "edit" -d "Edit a stack"
complete -c karl -n "__fish_seen_subcommand_from stacks" -a "set" -d "Update stack fields"
complete -c karl -n "__fish_seen_subcommand_from stacks" -a "remove" -d "Remove a stack"

# skills subcommands
complete -c karl -n "__fish_seen_subcommand_from skills" -a "list" -d "List available skills"
complete -c karl -n "__fish_seen_subcommand_from skills" -a "show" -d "Show skill details"
complete -c karl -n "__fish_seen_subcommand_from skills" -a "create" -d "Create a new skill"
complete -c karl -n "__fish_seen_subcommand_from skills" -a "validate" -d "Validate a skill"

# jobs subcommands
complete -c karl -n "__fish_seen_subcommand_from jobs" -a "clean" -d "Cleanup old completed jobs"

# completions subcommands
complete -c karl -n "__fish_seen_subcommand_from completions" -a "bash" -d "Bash completion script"
complete -c karl -n "__fish_seen_subcommand_from completions" -a "zsh" -d "Zsh completion script"
complete -c karl -n "__fish_seen_subcommand_from completions" -a "fish" -d "Fish completion script"

# config subcommands
complete -c karl -n "__fish_seen_subcommand_from config" -a "tui" -d "Launch config TUI"
complete -c karl -n "__fish_seen_subcommand_from config" -a "show" -d "Show config JSON"
complete -c karl -n "__fish_seen_subcommand_from config" -a "edit" -d "Edit config file"
complete -c karl -n "__fish_seen_subcommand_from config" -a "set" -d "Update config fields"

# debugdesign subcommands
complete -c karl -n "__fish_seen_subcommand_from debugdesign dd" -a "realistic" -d "Coding session simulation"
complete -c karl -n "__fish_seen_subcommand_from debugdesign dd" -a "stress" -d "Rapid-fire tool calls"
complete -c karl -n "__fish_seen_subcommand_from debugdesign dd" -a "errors" -d "Error and recovery patterns"
complete -c karl -n "__fish_seen_subcommand_from debugdesign dd" -a "all" -d "Run all scenarios"

# Run command flags
set -l run_cmds run ask do execute exec continue cont followup follow-up chain

# Flags for run commands
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l model -s m -d "Model alias" -xa "(__karl_models)"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l verbose -s v -d "Stream thoughts and tool calls"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l stream -d "Stream output"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l progress -d "Show progress"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l json -s j -d "JSON output"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l stats -d "Print summary stats"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l timeout -d "Per-task timeout"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l skill -d "Load a skill" -xa "(__karl_skills)"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l no-tools -d "Disable tool use"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l pure -d "Disable tool use"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l reasoning -d "Disable tool use"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l unrestricted -d "Allow writes outside working directory"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l context -d "Extra system prompt text"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l context-file -d "Path to context file" -r
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l continue -s c -d "Chain from last run"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l parent -d "Parent run id"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l follow-up -d "Alias for --parent"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l tag -d "Tag this run"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l no-history -d "Disable history logging"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l plain -d "ASCII-only output"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l visuals -d "Visual mode" -xa "auto unicode ascii plain none"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l background -d "Run in background"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -s bg -d "Run in background"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l stack -d "Use stack" -xa "(__karl_stacks)"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l dry-run -d "Show config without running"
complete -c karl -n "__fish_seen_subcommand_from $run_cmds; or __fish_seen_subcommand_from (__karl_stacks)" -l help -s h -d "Show help"
`;
}

function getCommandDescription(cmd: string): string {
  const descriptions: Record<string, string> = {
    run: 'Run a task',
    ask: 'Run a task (alias)',
    do: 'Run a task (alias)',
    execute: 'Run a task (alias)',
    exec: 'Run a task (alias)',
    continue: 'Chain from last run',
    cont: 'Chain from last run (alias)',
    followup: 'Chain from last run (alias)',
    'follow-up': 'Chain from last run (alias)',
    chain: 'Chain from last run (alias)',
    init: 'First-time setup wizard',
    setup: 'First-time setup (alias)',
    providers: 'Manage providers',
    models: 'Manage models',
    stacks: 'Manage config stacks',
    skills: 'Manage agent skills',
    config: 'Config TUI and JSON views',
    info: 'Show system info',
    status: 'Show status',
    history: 'Show run history',
    logs: 'Show logs',
    jobs: 'List background jobs',
    previous: 'Print last response',
    prev: 'Print last response (alias)',
    last: 'Print last response (alias)',
    tldr: 'Quick reference',
    help: 'Show help',
    agent: 'Interactive orchestrator',
    claude: 'Launch Claude Code with Karl tools',
    debugdesign: 'UI simulation for design',
    dd: 'UI simulation (alias)',
    completions: 'Generate shell completions'
  };
  return descriptions[cmd] || cmd;
}

function printHelp(): void {
  console.log(`karl completions <shell>

Generate shell completion scripts.

Shells:
  bash    Bash completion script
  zsh     Zsh completion script
  fish    Fish completion script

Installation:

  Bash (add to ~/.bashrc):
    eval "$(karl completions bash)"

    Or save to a file:
    karl completions bash > ~/.local/share/bash-completion/completions/karl

  Zsh (add to ~/.zshrc):
    eval "$(karl completions zsh)"

    Or save to fpath:
    karl completions zsh > ~/.zfunc/_karl
    # Then add to .zshrc before compinit:
    # fpath=(~/.zfunc $fpath)

  Fish:
    karl completions fish > ~/.config/fish/completions/karl.fish

Note: Stacks, models, and skills are fetched dynamically at completion time.
You only need to regenerate after updating karl itself (new commands/flags).
`);
}

export async function handleCompletionsCommand(args: string[]): Promise<void> {
  const shell = args[0];

  if (!shell || shell === '--help' || shell === '-h') {
    printHelp();
    return;
  }

  switch (shell) {
    case 'bash':
      console.log(generateBashCompletion());
      break;
    case 'zsh':
      console.log(generateZshCompletion());
      break;
    case 'fish':
      console.log(generateFishCompletion());
      break;
    default:
      console.error(`Unknown shell: ${shell}`);
      console.error('Supported shells: bash, zsh, fish');
      process.exitCode = 1;
  }
}
