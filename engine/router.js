/* ============================================================
   SPARK ENGINE — Hash Router
   Client-side SPA routing with transitions
   ============================================================ */

import { signal, computed } from './core.js';

const routes = new Map();
let notFoundHandler = null;
let beforeEachGuard = null;
let afterEachHook = null;

export const currentRoute = signal({ path: '', params: {}, query: {} });
export const previousRoute = signal(null);

export function createRouter(config = {}) {
    const { mode = 'hash', base = '' } = config;

    function parseHash() {
        const hash = window.location.hash.slice(1) || '/';
        const [pathPart, queryPart] = hash.split('?');
        const path = base ? pathPart.replace(base, '') || '/' : pathPart;
        const query = {};
        if (queryPart) {
            queryPart.split('&').forEach(pair => {
                const [k, v] = pair.split('=');
                query[decodeURIComponent(k)] = decodeURIComponent(v || '');
            });
        }
        return { path, query };
    }

    function matchRoute(path) {
        for (const [pattern, handler] of routes) {
            const params = matchPattern(pattern, path);
            if (params !== null) return { handler, params };
        }
        return null;
    }

    function matchPattern(pattern, path) {
        const patternParts = pattern.split('/').filter(Boolean);
        const pathParts = path.split('/').filter(Boolean);
        if (patternParts.length !== pathParts.length) return null;
        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }
        return params;
    }

    async function navigate(path, opts = {}) {
        const { replace = false, query = {} } = opts;
        let hash = base + path;
        const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        if (qs) hash += '?' + qs;

        if (replace) {
            window.location.replace('#' + hash);
        } else {
            window.location.hash = hash;
        }
    }

    function goBack() {
        window.history.back();
    }

    function onRoute(handler) {
        routes.set('*', handler);
    }

    function beforeEach(guard) {
        beforeEachGuard = guard;
    }

    function afterEach(hook) {
        afterEachHook = hook;
    }

    function notFound(handler) {
        notFoundHandler = handler;
    }

    async function handleRouteChange() {
        const { path, query } = parseHash();
        const matched = matchRoute(path);

        if (beforeEachGuard) {
            const proceed = await beforeEachGuard(path, currentRoute.peek());
            if (proceed === false) return;
        }

        previousRoute.value = currentRoute.peek();

        if (matched) {
            currentRoute.value = { path, params: matched.params, query };
            await matched.handler({ params: matched.params, query, path });
        } else {
            currentRoute.value = { path, params: {}, query };
            if (notFoundHandler) await notFoundHandler({ path, query });
        }

        if (afterEachHook) afterEachHook(path, currentRoute.peek());
    }

    window.addEventListener('hashchange', handleRouteChange);

    return {
        navigate,
        goBack,
        onRoute,
        beforeEach,
        afterEach,
        notFound,
        currentRoute,
        destroy() {
            window.removeEventListener('hashchange', handleRouteChange);
        }
    };
}

export function route(pattern, handler) {
    routes.set(pattern, handler);
}

export function navigate(path, opts) {
    let hash = path;
    const qs = opts?.query ? '?' + Object.entries(opts.query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
    hash += qs;
    if (opts?.replace) {
        window.location.replace('#' + hash);
    } else {
        window.location.hash = hash;
    }
}

export function getParams() {
    return currentRoute.peek().params;
}

export function getQuery() {
    return currentRoute.peek().query;
}
