/**
 * CLI commands for managing Agent Skills
 */

import { skillManager, SkillManager } from '../skills.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface SkillsListOptions {
  verbose?: boolean;
}

export interface SkillsValidateOptions {
  path: string;
}

export interface SkillsCreateOptions {
  name: string;
  description: string;
  path?: string;
}

/**
 * List all available skills
 */
export async function listSkills(options: SkillsListOptions = {}) {
  const skills = await skillManager.listSkills();

  if (skills.length === 0) {
    console.log('No skills found. Create skills in ~/.config/karl/skills/ or ./.karl/skills/');
    return;
  }

  console.log(`Found ${skills.length} skill${skills.length === 1 ? '' : 's'}:\n`);

  for (const skill of skills) {
    if (options.verbose) {
      console.log(`◍ ${skill.name}`);
      console.log(`  ${skill.description}`);
      console.log(`  Location: ${skill.path}\n`);
    } else {
      const truncatedDesc = skill.description.length > 80 
        ? skill.description.substring(0, 77) + '...' 
        : skill.description;
      console.log(`◍ ${skill.name.padEnd(20)} ${truncatedDesc}`);
    }
  }
}

/**
 * Show detailed information about a specific skill
 */
export async function showSkill(name: string) {
  const skill = await skillManager.getSkill(name);

  if (!skill) {
    console.error(`Skill "${name}" not found.`);
    process.exit(1);
  }

  console.log(`# ${skill.metadata.name}\n`);
  console.log(`**Description:** ${skill.metadata.description}\n`);
  
  if (skill.metadata.license) {
    console.log(`**License:** ${skill.metadata.license}`);
  }
  
  if (skill.metadata.compatibility) {
    console.log(`**Compatibility:** ${skill.metadata.compatibility}`);
  }
  
  if (skill.metadata['allowed-tools']) {
    console.log(`**Allowed Tools:** ${skill.metadata['allowed-tools']}`);
  }

  if (skill.metadata.metadata) {
    console.log(`\n**Metadata:**`);
    for (const [key, value] of Object.entries(skill.metadata.metadata)) {
      console.log(`- ${key}: ${value}`);
    }
  }

  console.log(`\n**Location:** ${skill.path}`);
  
  console.log(`\n**Content:**\n`);
  console.log(skill.content);
}

/**
 * Validate a skill
 */
export async function validateSkill(options: SkillsValidateOptions) {
  try {
    const manager = new SkillManager();
    const skill = await manager.loadSkillFromPath(options.path);
    
    console.log(`✓ Skill "${skill.metadata.name}" is valid`);
    console.log(`  Description: ${skill.metadata.description}`);
    
    if (skill.metadata.license) {
      console.log(`  License: ${skill.metadata.license}`);
    }
    
    return true;
  } catch (error) {
    console.error(`✗ Skill validation failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Create a new skill template
 */
export async function createSkill(options: SkillsCreateOptions) {
  const skillPath = options.path || join(process.cwd(), options.name);
  
  try {
    // Create skill directory
    mkdirSync(skillPath, { recursive: true });
    
    // Create subdirectories
    mkdirSync(join(skillPath, 'scripts'), { recursive: true });
    mkdirSync(join(skillPath, 'references'), { recursive: true });
    mkdirSync(join(skillPath, 'assets'), { recursive: true });

    // Create SKILL.md template
    const skillContent = createSkillTemplate(options.name, options.description);
    writeFileSync(join(skillPath, 'SKILL.md'), skillContent);

    // Create README.md
    const readmeContent = createReadmeTemplate(options.name, options.description);
    writeFileSync(join(skillPath, 'README.md'), readmeContent);

    // Create example reference
    const referenceContent = createReferenceTemplate(options.name);
    writeFileSync(join(skillPath, 'references', 'REFERENCE.md'), referenceContent);

    console.log(`✓ Skill "${options.name}" created at ${skillPath}`);
    console.log(`\nNext steps:`);
    console.log(`1. Edit ${join(skillPath, 'SKILL.md')} with your skill instructions`);
    console.log(`2. Add any scripts to the scripts/ directory`);
    console.log(`3. Add detailed references to the references/ directory`);
    console.log(`4. Test your skill with: karl skills validate ${skillPath}`);
    console.log(`5. Use your skill with: karl --skill ${options.name} "your task"`);

  } catch (error) {
    console.error(`Failed to create skill: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Generate a SKILL.md template
 */
function createSkillTemplate(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
license: Apache-2.0
metadata:
  author: $(whoami)
  version: "1.0"
---

# ${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Skill

## Overview

${description}

## Instructions

You are a specialized assistant focused on ${name.replace(/-/g, ' ')}.

### Primary Capabilities

- [List your main capabilities here]
- [Add specific tasks this skill handles]
- [Include any domain expertise]

### Process

1. **Analysis**: [Describe how you analyze the input]
2. **Planning**: [Explain your approach to planning]
3. **Execution**: [Detail your execution strategy]
4. **Verification**: [How you verify results]

### Best Practices

- [List important guidelines]
- [Include any constraints or limitations]
- [Add quality standards]

### Common Patterns

#### Pattern 1: [Describe a common use case]

\`\`\`
Example usage pattern
\`\`\`

#### Pattern 2: [Another common scenario]

\`\`\`
Another example
\`\`\`

### Error Handling

- [How to handle common errors]
- [Recovery strategies]
- [When to ask for clarification]

### Resources

For additional information, see:
- [Reference documentation](references/REFERENCE.md)
- [Example scripts](scripts/)

## Examples

### Example 1: Basic Usage

**Input:** [Sample input]

**Process:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Output:** [Expected output format]

### Example 2: Complex Scenario

**Input:** [More complex sample]

**Process:** [Detailed steps for complex case]

**Output:** [Expected complex output]
`;
}

/**
 * Generate a README.md template
 */
function createReadmeTemplate(name: string, description: string): string {
  return `# ${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Skill

${description}

## Usage

\`\`\`bash
karl --skill ${name} "your task description"
\`\`\`

## Structure

\`\`\`
${name}/
├── SKILL.md           # Main skill definition
├── README.md          # This file
├── scripts/           # Executable scripts
├── references/        # Additional documentation
└── assets/           # Static resources
\`\`\`

## Files

- **SKILL.md**: Main skill instructions for the agent
- **scripts/**: Utility scripts the agent can execute
- **references/**: Detailed documentation loaded on demand
- **assets/**: Templates, images, and other static files

## Requirements

[List any special requirements, dependencies, or compatibility notes]

## License

[Specify the license for this skill]
`;
}

/**
 * Generate a reference template
 */
function createReferenceTemplate(name: string): string {
  return `# ${name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Reference

This document provides detailed technical reference for the ${name} skill.

## API Reference

[Document any APIs or interfaces this skill uses]

## Configuration

[Document any configuration options]

## Troubleshooting

### Common Issues

1. **Issue 1**: Description
   - **Cause**: What causes this
   - **Solution**: How to fix it

2. **Issue 2**: Description
   - **Cause**: What causes this
   - **Solution**: How to fix it

### Debugging

[Provide debugging tips and techniques]

## Advanced Usage

[Document advanced patterns and use cases]

## Related Skills

- [List related skills that work well together]
- [Cross-references to other skills]
`;
}

/**
 * Handle skills subcommands
 */
export async function handleSkillsCommand(args: string[]) {
  const [command, ...rest] = args;

  switch (command) {
    case 'list':
    case 'ls':
      const verbose = rest.includes('--verbose') || rest.includes('-v');
      await listSkills({ verbose });
      break;

    case 'show':
    case 'info':
      if (rest.length === 0) {
        console.error('Usage: karl skills show <skill-name>');
        process.exit(1);
      }
      await showSkill(rest[0]);
      break;

    case 'create':
    case 'new':
      if (rest.length === 0) {
        console.error('Usage: karl skills create <skill-name> [--description "..."] [--path /path/to/skill]');
        process.exit(1);
      }
      
      const name = rest[0];
      let description = `${name.replace(/-/g, ' ')} skill`;
      let path = undefined;

      // Parse flags
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === '--description' && rest[i + 1]) {
          description = rest[++i];
        } else if (rest[i] === '--path' && rest[i + 1]) {
          path = rest[++i];
        }
      }

      await createSkill({ name, description, path });
      break;

    case 'validate':
    case 'check':
      if (rest.length === 0) {
        console.error('Usage: karl skills validate <skill-path>');
        process.exit(1);
      }
      await validateSkill({ path: rest[0] });
      break;

    default:
      console.error(`Unknown skills command: ${command}`);
      console.error('Available commands: list, show, create, validate');
      process.exit(1);
  }
}