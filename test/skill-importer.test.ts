import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown } from '../src/main/integrations/SkillImporter.js';

describe('parseSkillMarkdown', () => {
  it('parses frontmatter with name, description, tools', () => {
    const md = `---
name: Code Reviewer
description: Reviews code for bugs and style
tools: [file_read, shell_exec]
---
You are an expert code reviewer. Check for bugs, security issues and style.
`;
    const s = parseSkillMarkdown(md, 'https://github.com/x/y');
    expect(s.name).toBe('Code Reviewer');
    expect(s.description).toBe('Reviews code for bugs and style');
    expect(s.toolNames).toEqual(['file_read', 'shell_exec']);
    expect(s.prompt).toContain('expert code reviewer');
  });

  it('falls back to heading + first paragraph without frontmatter', () => {
    const md = `# Data Analyst

Analyzes datasets and produces reports.

More details here.`;
    const s = parseSkillMarkdown(md, 'https://github.com/x/y');
    expect(s.name).toBe('Data Analyst');
    expect(s.description).toContain('Analyzes datasets');
    expect(s.prompt.length).toBeGreaterThan(0);
  });

  it('handles quoted frontmatter values', () => {
    const md = `---
name: "Writer"
description: 'Writes copy'
tools: shell_exec, open_url
---
Body text.`;
    const s = parseSkillMarkdown(md, 'src');
    expect(s.name).toBe('Writer');
    expect(s.description).toBe('Writes copy');
    expect(s.toolNames).toEqual(['shell_exec', 'open_url']);
  });
});
