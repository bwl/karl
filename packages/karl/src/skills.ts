/**
 * Agent Skills implementation for Karl
 *
 * Supports the Agent Skills open standard for extending agent capabilities
 * with specialized knowledge and workflows.
 */

import { readFileSync, existsSync, lstatSync, readdirSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { homedir } from 'os';

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;
  path: string;
}

export interface SkillValidationError {
  field: string;
  message: string;
}

export class SkillManager {
  private skillsCache = new Map<string, Skill>();
  private readonly skillsPaths: string[];

  constructor(customPaths: string[] = []) {
    this.skillsPaths = [
      // Standard paths
      join(homedir(), '.config', 'karl', 'skills'),
      join(process.cwd(), '.karl', 'skills'),
      // Custom paths
      ...customPaths
    ];
  }

  /**
   * Load all available skills from configured paths
   */
  async loadAvailableSkills(): Promise<Map<string, Skill>> {
    const skills = new Map<string, Skill>();

    for (const skillsPath of this.skillsPaths) {
      if (!existsSync(skillsPath)) continue;

      try {
        const entries = readdirSync(skillsPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const skillPath = join(skillsPath, entry.name);
          const skillFile = join(skillPath, 'SKILL.md');
          
          // Check if SKILL.md exists (works for both directories and symlinks)
          if (!existsSync(skillFile)) continue;
          
          try {
            const skill = await this.loadSkillFromPath(skillPath);
            skills.set(skill.metadata.name, skill);
          } catch (error) {
            console.warn(`Failed to load skill ${entry.name}:`, error);
          }
        }
      } catch (error) {
        console.warn(`Failed to read skills directory ${skillsPath}:`, error);
      }
    }

    this.skillsCache = skills;
    return skills;
  }

  /**
   * Load a specific skill by name
   */
  async getSkill(name: string): Promise<Skill | null> {
    // Check cache first
    if (this.skillsCache.has(name)) {
      return this.skillsCache.get(name)!;
    }

    // Search for skill in all paths
    for (const skillsPath of this.skillsPaths) {
      const skillPath = join(skillsPath, name);
      const skillFile = join(skillPath, 'SKILL.md');
      
      if (existsSync(skillFile)) {
        try {
          const skill = await this.loadSkillFromPath(skillPath);
          this.skillsCache.set(name, skill);
          return skill;
        } catch (error) {
          console.warn(`Failed to load skill ${name}:`, error);
        }
      }
    }

    return null;
  }

  /**
   * Simple frontmatter parser
   */
  private parseFrontmatter(content: string): { data: any; content: string } {
    const lines = content.split('\n');
    
    if (lines[0] !== '---') {
      throw new Error('SKILL.md must start with YAML frontmatter (---)');
    }
    
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        endIndex = i;
        break;
      }
    }
    
    if (endIndex === -1) {
      throw new Error('SKILL.md frontmatter must end with ---');
    }
    
    const yamlContent = lines.slice(1, endIndex).join('\n');
    const markdownContent = lines.slice(endIndex + 1).join('\n').trim();
    
    // Simple YAML parser for our limited needs
    const data: any = {};
    const yamlLines = yamlContent.split('\n');
    
    for (const line of yamlLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      if (trimmed.includes(': ')) {
        const [key, ...valueParts] = trimmed.split(': ');
        let value = valueParts.join(': ').trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        data[key.trim()] = value;
      } else if (trimmed.endsWith(':')) {
        // Handle nested objects (like metadata:)
        const key = trimmed.slice(0, -1).trim();
        data[key] = {};
        // Note: This simple parser doesn't handle nested YAML fully
        // For a production implementation, consider using a proper YAML library
      }
    }
    
    return { data, content: markdownContent };
  }

  /**
   * Load skill from a directory path
   */
  async loadSkillFromPath(skillPath: string): Promise<Skill> {
    const skillFile = join(skillPath, 'SKILL.md');
    
    if (!existsSync(skillFile)) {
      throw new Error(`SKILL.md not found in ${skillPath}`);
    }

    const content = readFileSync(skillFile, 'utf-8');
    const parsed = this.parseFrontmatter(content);
    
    // Validate metadata
    const errors = this.validateMetadata(parsed.data);
    if (errors.length > 0) {
      throw new Error(`Invalid skill metadata: ${errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
    }

    const metadata = parsed.data as SkillMetadata;
    
    // Validate directory name matches skill name
    const dirName = basename(skillPath);
    if (metadata.name !== dirName) {
      throw new Error(`Skill name "${metadata.name}" must match directory name "${dirName}"`);
    }

    return {
      metadata,
      content: parsed.content,
      path: skillPath
    };
  }

  /**
   * Validate skill metadata according to Agent Skills spec
   */
  private validateMetadata(data: any): SkillValidationError[] {
    const errors: SkillValidationError[] = [];

    // Required fields
    if (!data.name) {
      errors.push({ field: 'name', message: 'Required field missing' });
    } else {
      // Name validation
      if (typeof data.name !== 'string') {
        errors.push({ field: 'name', message: 'Must be a string' });
      } else if (data.name.length > 64) {
        errors.push({ field: 'name', message: 'Must be 64 characters or less' });
      } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name)) {
        errors.push({ field: 'name', message: 'Must contain only lowercase letters, numbers, and hyphens; cannot start/end with hyphen or contain consecutive hyphens' });
      }
    }

    if (!data.description) {
      errors.push({ field: 'description', message: 'Required field missing' });
    } else {
      // Description validation
      if (typeof data.description !== 'string') {
        errors.push({ field: 'description', message: 'Must be a string' });
      } else if (data.description.length > 1024) {
        errors.push({ field: 'description', message: 'Must be 1024 characters or less' });
      } else if (data.description.trim().length === 0) {
        errors.push({ field: 'description', message: 'Cannot be empty' });
      }
    }

    // Optional field validation
    if (data.license !== undefined && typeof data.license !== 'string') {
      errors.push({ field: 'license', message: 'Must be a string' });
    }

    if (data.compatibility !== undefined) {
      if (typeof data.compatibility !== 'string') {
        errors.push({ field: 'compatibility', message: 'Must be a string' });
      } else if (data.compatibility.length > 500) {
        errors.push({ field: 'compatibility', message: 'Must be 500 characters or less' });
      }
    }

    if (data.metadata !== undefined && (typeof data.metadata !== 'object' || data.metadata === null || Array.isArray(data.metadata))) {
      errors.push({ field: 'metadata', message: 'Must be an object' });
    }

    if (data['allowed-tools'] !== undefined && typeof data['allowed-tools'] !== 'string') {
      errors.push({ field: 'allowed-tools', message: 'Must be a string' });
    }

    return errors;
  }

  /**
   * Generate system prompt content for a skill
   */
  generateSystemPrompt(skill: Skill): string {
    let prompt = `# ${skill.metadata.name}\n\n`;
    prompt += `${skill.metadata.description}\n\n`;
    prompt += skill.content;

    return prompt;
  }

  /**
   * List available skills with metadata
   */
  async listSkills(): Promise<Array<{ name: string; description: string; path: string }>> {
    await this.loadAvailableSkills();
    
    return Array.from(this.skillsCache.values()).map(skill => ({
      name: skill.metadata.name,
      description: skill.metadata.description,
      path: skill.path
    }));
  }

  /**
   * Read a reference file from a skill
   */
  readSkillReference(skill: Skill, referencePath: string): string | null {
    const fullPath = join(skill.path, referencePath);
    
    // Ensure we're not escaping the skill directory
    if (!fullPath.startsWith(skill.path)) {
      throw new Error('Reference path cannot escape skill directory');
    }

    if (!existsSync(fullPath)) {
      return null;
    }

    try {
      return readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Get allowed tools for a skill
   */
  getAllowedTools(skill: Skill): string[] | null {
    if (!skill.metadata['allowed-tools']) {
      return null;
    }

    return skill.metadata['allowed-tools'].split(/\s+/).filter(tool => tool.length > 0);
  }
}



/**
 * Default skill manager instance
 */
export const skillManager = new SkillManager();

/**
 * Load a skill by name and return its content as a string
 * This is a convenience function for the context builder
 */
export async function loadSkill(skillName: string, cwd: string): Promise<string | null> {
  try {
    // Create a temporary skill manager with project-specific paths
    const manager = new SkillManager([
      join(cwd, '.karl', 'skills')
    ]);
    
    const skill = await manager.getSkill(skillName);
    if (!skill) {
      console.warn(`Skill "${skillName}" not found`);
      return null;
    }
    
    return manager.generateSystemPrompt(skill);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load skill "${skillName}":`, message);
    return null;
  }
}