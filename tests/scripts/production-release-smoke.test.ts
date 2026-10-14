import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSetupResponse } from '../../scripts/production-release-smoke.mjs';

describe('production deployment guards', () => {
  it('limits production release jobs to main independently of tag validation', () => {
    const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
    expect(workflow).toMatch(/validate:[\s\S]*?if: github\.repository == '[^']+' && github\.ref == 'refs\/heads\/main'/);
    expect(workflow).toMatch(/release:[\s\S]*?if: github\.repository == '[^']+' && github\.ref == 'refs\/heads\/main'/);
    expect(workflow).toContain('[[ "$GITHUB_REF" == refs/heads/main ]]');
    expect(workflow).toContain('environment: production');
  });

  it('checks setup HTTP contract rather than language or page copy', () => {
    const valid = (html: string) => new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    expect(isSetupResponse(valid('<h1>Настройка бота</h1>'))).toBe(true);
    expect(isSetupResponse(valid('<h1>Set up bot</h1>'))).toBe(true);
    expect(isSetupResponse(new Response('Authentication required', {
      status: 401,
      headers: { Location: '/admin', 'Cache-Control': 'no-store' },
    }))).toBe(true);
    expect(isSetupResponse(new Response('Blocked by edge', {
      status: 401,
    }))).toBe(false);
    expect(isSetupResponse(new Response('missing', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    }))).toBe(false);
    expect(isSetupResponse(new Response('{"ok":true}', {
      headers: { 'Content-Type': 'application/json' },
    }))).toBe(false);
  });
});
