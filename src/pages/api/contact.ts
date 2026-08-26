// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0
import type { APIRoute } from 'astro';

export const prerender = false;

const CONTACT_TO = 'contact@opensourceom.org';
const MAX_NAME = 200;
const MAX_MESSAGE = 5000;

function json(status: number, body: { ok: boolean; error?: string }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: 'Invalid request.' });
  }

  const honeypot = String(payload.company ?? '').trim();
  if (honeypot) {
    return json(200, { ok: true });
  }

  const name = String(payload.name ?? '').trim();
  const email = String(payload.email ?? '').trim();
  const message = String(payload.message ?? '').trim();

  if (!name || name.length > MAX_NAME || !isEmail(email) || !message || message.length > MAX_MESSAGE) {
    return json(400, { ok: false, error: 'Please provide a valid name, email, and message.' });
  }

  const apiKey = import.meta.env.RESEND_API_KEY as string | undefined;
  if (!apiKey) {
    return json(503, {
      ok: false,
      error: 'Email sending is not configured yet. Please email contact@opensourceom.org directly.',
    });
  }

  const from = (import.meta.env.CONTACT_FROM as string | undefined) ?? `OpenSourceOM <${CONTACT_TO}>`;
  const to = (import.meta.env.CONTACT_TO as string | undefined) ?? CONTACT_TO;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `Contact form: ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    }),
  });

  if (!res.ok) {
    return json(502, {
      ok: false,
      error: 'Could not send the message. Please email contact@opensourceom.org instead.',
    });
  }

  return json(200, { ok: true });
};
