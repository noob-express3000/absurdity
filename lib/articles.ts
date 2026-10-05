import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { CandidateEvidence } from './providers/intelligence';
import type { IngestedEvidence } from './types';

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_CHARS = 120000;
export type ArticlePage = { html: string | Buffer; url: string; contentType?: string };
export type PageLoader = (url: string) => Promise<ArticlePage>;
type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;
export type ArticleTarget = { url: URL; address: Address };
type TransportResponse = { status: number; headers: IncomingHttpHeaders; body: AsyncIterable<Uint8Array>; close: () => void };
export type ArticleTransport = (target: ArticleTarget, signal: AbortSignal) => Promise<TransportResponse>;

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export async function resolveArticleTarget(value: string, resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true })) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Unsupported article URL.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname) ? [{address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6}] : await resolve(hostname);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Article host is not a public address.');
  url.hash = '';
  return {url, address: addresses.find(item => item.family === 4) ?? addresses[0]};
}

export const requestArticlePage: ArticleTransport = (target, signal) => new Promise((resolve, reject) => {
  // Pin the validated address for the actual socket as well as every redirect.
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [target.address]);
    else callback(null, target.address.address, target.address.family);
  };
  const request = (target.url.protocol === 'https:' ? httpsRequest : httpRequest)(target.url, {
    signal, agent: false, lookup: pinnedLookup, family: target.address.family,
    headers: { 'User-Agent': 'Absurdity/0.3 (article research)', Accept: 'text/html, application/xhtml+xml', 'Accept-Encoding': 'identity' },
  }, response => resolve({status: response.statusCode ?? 0, headers: response.headers, body: response, close: () => response.destroy()}));
  request.on('error', reject);
  request.end();
});

export async function fetchPublicPage(value: string, options: {resolve?: Resolver; transport?: ArticleTransport; timeoutMs?: number; maxBytes?: number} = {}): Promise<ArticlePage> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 12000);
  const maxBytes = options.maxBytes ?? MAX_PAGE_BYTES;
  let current = value;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const target = await new Promise<ArticleTarget>((resolve, reject) => {
      const abort = () => reject(new Error('Article request timed out.'));
      signal.addEventListener('abort', abort, {once:true});
      if (signal.aborted) abort();
      resolveArticleTarget(current, options.resolve).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    const response = await (options.transport ?? requestArticlePage)(target, signal);
    try {
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.location;
        if (!location || redirects === 4) throw new Error('Article redirect limit reached.');
        current = new URL(location, target.url).toString();
        continue;
      }
      if (response.status !== 200) throw new Error(`Article HTTP ${response.status}.`);
      if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(String(response.headers['content-type'] ?? ''))) throw new Error('Article response is not HTML.');
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('Unexpected compressed article response.');
      if (Number(response.headers['content-length'] ?? 0) > maxBytes) throw new Error('Article response is too large.');
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new Error('Article response is too large.');
        chunks.push(Buffer.from(chunk));
      }
      // JSDOM's byte constructor handles declared HTML encodings during extraction.
      return {html: Buffer.concat(chunks), url: target.url.toString(), contentType:String(response.headers['content-type'])};
    } finally { response.close(); }
  }
  throw new Error('Article redirect limit reached.');
}

function cleanText(text: string) {
  return text.replace(/\r/g, '').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractArticle(page: ArticlePage) {
  const raw = typeof page.html === 'string' ? page.html : page.html.toString('latin1');
  if ((typeof page.html === 'string' ? Buffer.byteLength(page.html) : page.html.byteLength) > MAX_PAGE_BYTES) throw new Error('Article response is too large.');
  let elements = 0;
  for (const _tag of raw.matchAll(/<[a-zA-Z]/g)) {
    if (++elements > 50000) throw new Error('Article page has too many elements.');
  }
  const dom = new JSDOM(page.html, {url: page.url, contentType:page.contentType ?? 'text/html', virtualConsole: new VirtualConsole()});
  try {
    const document = dom.window.document;
    // Respect publisher restrictions; do not use hidden JSON-LD text to bypass a paywall.
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (/"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(script.textContent ?? '')) throw new Error('Article is restricted.');
    }
    document.querySelectorAll('script, style, noscript, nav, footer, aside, form, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
    const article = new Readability(document, {maxElemsToParse:50000, charThreshold:200, serializer: node => {
      (node as Element).querySelectorAll('p, h1, h2, h3, h4, li, blockquote, br').forEach(block => block.appendChild(document.createTextNode('\n\n')));
      return node.textContent ?? '';
    }}).parse();
    const text = cleanText(article?.content ?? '');
    if (text.length < 200 || /^(access denied|verify you are human|just a moment)/i.test(article?.title?.trim() ?? '')) throw new Error('No readable article body.');
    return {title: article?.title?.trim() || '', text: text.slice(0, MAX_ARTICLE_CHARS), originalLength:text.length, truncated:text.length > MAX_ARTICLE_CHARS};
  } finally { dom.window.close(); }
}

export async function ingestSource(source: CandidateEvidence, load: PageLoader = fetchPublicPage): Promise<IngestedEvidence> {
  const fetchedAt = new Date().toISOString();
  const base = {publisher:source.publisher, title:source.title, url:source.url,
    ...(source.publishedAt ? {publishedAt:source.publishedAt} : {})};
  try {
    const page = await load(source.url);
    const article = extractArticle(page);
    return {...base, title:article.title || source.title, text:article.text, resolvedUrl:page.url, fetchedAt,
      status:'article', method:'readability', originalLength:article.originalLength, truncated:article.truncated,
      contentHash:createHash('sha256').update(article.text).digest('hex')};
  } catch (error) {
    const text = source.text?.trim() ?? '';
    return {...base, text, resolvedUrl:source.url, fetchedAt, status:text ? 'excerpt' : 'unavailable', method:source.kind === 'search' ? 'search' : 'rss',
      originalLength:text.length, truncated:false, contentHash:createHash('sha256').update(text).digest('hex'),
      error:error instanceof Error ? error.message : 'Article retrieval failed.'};
  }
}
