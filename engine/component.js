/* ============================================================
   SPARK ENGINE — Component System
   Functional components, template rendering, lifecycle, DOM diffing
   ============================================================ */

import { signal, effect, untrack } from './core.js';

const componentRegistry = new Map();
const mountedComponents = new WeakMap();

let idCounter = 0;
function genId() { return `_sp${++idCounter}`; }

export function defineComponent(name, factory) {
    componentRegistry.set(name, factory);
}

export function mount(selector, componentFactory, props = {}) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return null;

    const ctx = {
        id: genId(),
        el,
        props: { ...props },
        signals: {},
        effects: [],
        children: [],
        cleanup: [],
        alive: true
    };

    mountedComponents.set(el, ctx);

    const destroy = () => {
        ctx.alive = false;
        ctx.effects.forEach(e => e.dispose());
        ctx.cleanup.forEach(fn => fn());
        ctx.children.forEach(c => c.destroy?.());
        el.innerHTML = '';
        mountedComponents.delete(el);
    };

    ctx.destroy = destroy;

    const result = componentFactory(ctx);
    if (typeof result === 'string') el.innerHTML = result;
    else if (result instanceof HTMLElement) { el.innerHTML = ''; el.appendChild(result); }

    return { el, ctx, destroy };
}

export function html(strings, ...values) {
    const template = document.createElement('template');
    let raw = '';
    for (let i = 0; i < strings.length; i++) {
        raw += strings[i];
        if (i < values.length) {
            const v = values[i];
            if (typeof v === 'function') {
                const id = genId();
                raw += `<span data-spark-id="${id}"></span>`;
                queueMicrotask(() => {
                    const node = template.content.querySelector(`[data-spark-id="${id}"]`);
                    if (node) {
                        const cleanup = effect(() => {
                            const result = v();
                            if (result instanceof HTMLElement) {
                                node.innerHTML = '';
                                node.appendChild(result);
                            } else if (typeof result === 'string') {
                                node.innerHTML = result;
                            } else if (result === null || result === undefined) {
                                node.innerHTML = '';
                            }
                        });
                        if (mountedComponents.size > 0) {
                            const lastCtx = [...mountedComponents.values()].pop();
                            if (lastCtx) lastCtx.effects.push(cleanup);
                        }
                    }
                });
            } else if (v instanceof HTMLElement) {
                const id = genId();
                raw += `<span data-spark-id="${id}"></span>`;
                queueMicrotask(() => {
                    const node = template.content.querySelector(`[data-spark-id="${id}"]`);
                    if (node) { node.innerHTML = ''; node.appendChild(v); }
                });
            } else if (v !== null && v !== undefined) {
                raw += String(v);
            }
        }
    }
    template.innerHTML = raw;
    return template.content;
}

export function frag(childNodes) {
    const f = document.createDocumentFragment();
    childNodes.forEach(n => f.appendChild(n.cloneNode(true)));
    return f;
}

export function onMount(ctx, fn) {
    if (!ctx.alive) return;
    queueMicrotask(() => fn(ctx));
}

export function onCleanup(ctx, fn) {
    if (ctx) ctx.cleanup.push(fn);
    else return fn;
}

export function createElement(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
        if (key.startsWith('on') && typeof val === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'className') {
            el.className = val;
        } else if (key === 'style' && typeof val === 'object') {
            Object.assign(el.style, val);
        } else if (key === 'dataset') {
            Object.assign(el.dataset, val);
        } else {
            el.setAttribute(key, val);
        }
    }
    for (const child of children) {
        if (child == null || child === false) continue;
        if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement || child instanceof DocumentFragment) {
            el.appendChild(child);
        } else if (Array.isArray(child)) {
            child.forEach(c => {
                if (c instanceof HTMLElement) el.appendChild(c);
                else if (c != null) el.appendChild(document.createTextNode(c));
            });
        }
    }
    return el;
}

export function render(target, componentFn) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    el.innerHTML = '';
    const result = componentFn();
    if (result instanceof HTMLElement) el.appendChild(result);
    else if (typeof result === 'string') el.innerHTML = result;
    return el;
}

export function showIf(target, conditionFn, trueFn, falseFn = () => '') {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    effect(() => {
        const result = conditionFn() ? trueFn() : falseFn();
        if (result instanceof HTMLElement) {
            el.innerHTML = '';
            el.appendChild(result);
        } else {
            el.innerHTML = result;
        }
    });
}

export function list(target, itemsFn, renderFn) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    effect(() => {
        const items = itemsFn();
        el.innerHTML = '';
        items.forEach((item, i) => {
            const node = renderFn(item, i);
            if (node instanceof HTMLElement) el.appendChild(node);
            else if (typeof node === 'string') {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = node;
                el.appendChild(wrapper);
            }
        });
    });
}
