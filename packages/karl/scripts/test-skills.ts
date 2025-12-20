#!/usr/bin/env bun
/**
 * Test script for Agent Skills implementation
 */

import { skillManager } from '../src/skills.js';
import { join } from 'path';

async function testSkills() {
  console.log('🧪 Testing Agent Skills implementation...\n');

  // Test 1: Load example skills
  console.log('1. Loading example skills...');
  try {
    const exampleSkillsPath = join(import.meta.dir, '../examples/skills');
    const manager = skillManager;
    
    // Add example skills path to manager
    manager['skillsPaths'].push(exampleSkillsPath);
    
    const skills = await manager.loadAvailableSkills();
    console.log(`   ✓ Found ${skills.size} skills:`);
    
    for (const [name, skill] of skills) {
      console.log(`     - ${name}: ${skill.metadata.description.substring(0, 80)}...`);
    }
  } catch (error) {
    console.error(`   ✗ Error loading skills: ${error.message}`);
    return;
  }

  console.log();

  // Test 2: Load specific skill
  console.log('2. Testing specific skill loading...');
  try {
    const skill = await skillManager.getSkill('security-review');
    if (skill) {
      console.log(`   ✓ Loaded skill: ${skill.metadata.name}`);
      console.log(`     Description: ${skill.metadata.description}`);
      console.log(`     License: ${skill.metadata.license || 'Not specified'}`);
      console.log(`     Content length: ${skill.content.length} characters`);
      
      // Test allowed tools parsing
      const allowedTools = skillManager.getAllowedTools(skill);
      if (allowedTools) {
        console.log(`     Allowed tools: ${allowedTools.join(', ')}`);
      }
    } else {
      console.error('   ✗ Failed to load security-review skill');
    }
  } catch (error) {
    console.error(`   ✗ Error loading specific skill: ${error.message}`);
  }

  console.log();

  // Test 3: Generate system prompt
  console.log('3. Testing system prompt generation...');
  try {
    const skill = await skillManager.getSkill('code-review');
    if (skill) {
      const prompt = skillManager.generateSystemPrompt(skill);
      console.log(`   ✓ Generated system prompt (${prompt.length} characters)`);
      console.log(`     Preview: ${prompt.substring(0, 200)}...`);
    } else {
      console.error('   ✗ Could not find code-review skill');
    }
  } catch (error) {
    console.error(`   ✗ Error generating system prompt: ${error.message}`);
  }

  console.log();

  // Test 4: Validation
  console.log('4. Testing skill validation...');
  try {
    const exampleSkillPath = join(import.meta.dir, '../examples/skills/security-review');
    const skill = await skillManager.loadSkillFromPath(exampleSkillPath);
    console.log(`   ✓ Validation passed for ${skill.metadata.name}`);
    console.log(`     All required fields present and valid`);
  } catch (error) {
    console.error(`   ✗ Validation error: ${error.message}`);
  }

  console.log();

  // Test 5: List skills function
  console.log('5. Testing skills listing...');
  try {
    const skillsList = await skillManager.listSkills();
    console.log(`   ✓ Skills list contains ${skillsList.length} entries`);
    for (const skill of skillsList.slice(0, 3)) {
      console.log(`     - ${skill.name}: ${skill.description.substring(0, 60)}...`);
    }
  } catch (error) {
    console.error(`   ✗ Error listing skills: ${error.message}`);
  }

  console.log('\n🎉 Agent Skills testing completed!');
}

// Run the tests
testSkills().catch((error) => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});