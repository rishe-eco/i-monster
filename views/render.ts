import type { Context } from 'hono';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Send a JSX page as an HTML response, with its doctype. */
export async function page(
  c: Context,
  node: HtmlEscapedString | Promise<HtmlEscapedString>,
  status: ContentfulStatusCode = 200,
): Promise<Response> {
  return c.html(`<!DOCTYPE html>${String(await node)}`, status);
}
