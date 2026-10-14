/** Application-scoped transport: preview proxies may reserve Authorization.
 * This contains the same signed access JWT, never a user/role ID or bypass flag. */
export const ACCESS_TOKEN_HEADER = "X-REMS-Access-Token";
