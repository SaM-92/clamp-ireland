import { expect, test } from "@playwright/test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setImmediate } from "node:timers";
import { policyRuntime } from "./helpers/content-policy-runtime";

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(edit = false) {
  const state = {
    identity: { username: "river_walker", needsOnboarding: false } as unknown,
    saveResponse: undefined as unknown, status: 200, hang: "" as "" | "fetch" | "json",
    calls: [] as { method: string; signal: AbortSignal; body?: string }[],
    redirects: [] as string[], refreshes: 0,
  };
  const slots: unknown[] = [];
  const effects: (() => (() => void))[] = [];
  const cleanups: (() => void)[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  let cursor = 0;
  let mounted = false;
  const router = { replace: (url: string) => state.redirects.push(url), refresh: () => { state.refreshes++; } };
  const rt = policyRuntime({
    react: {
      ...React,
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: unknown) => { slots[index] = value; }];
      },
      useRef: (initial: unknown) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect: (effect: () => (() => void)) => { if (!mounted) effects.push(effect); },
    },
    "next/navigation": { useRouter: () => router },
    "next/link": "a",
  }, {
    AbortController, AbortSignal,
    setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id: number) => { timers.delete(id); },
    fetch: async (_url: string, init: { method: string; signal: AbortSignal; body?: string }) => {
      state.calls.push(init);
      if (state.hang === "fetch") return new Promise(() => {});
      if (state.hang === "json") return { ok: true, status: 200, json: () => new Promise(() => {}) };
      const requested = init.body ? (JSON.parse(init.body) as { username: string }).username : undefined;
      const body = init.method === "PUT"
        ? state.saveResponse ?? { username: requested, needsOnboarding: false } : state.identity;
      return new Response(JSON.stringify(body), { status: state.status });
    },
  });
  const { UsernameForm } = rt.load<typeof import("../src/modules/auth/components/UsernameForm")>(
    "src/modules/auth/components/UsernameForm.tsx",
  );
  function render() {
    cursor = 0;
    const result = UsernameForm({ edit });
    if (!mounted) {
      mounted = true;
      for (const effect of effects) cleanups.push(effect());
    }
    return result;
  }
  function field(type: string) {
    const found = elements(render()).find((element) => element.type === type);
    if (!found) throw new Error(`Missing ${type}`);
    return found.props;
  }
  return {
    state, render, field, timers,
    markup: () => renderToStaticMarkup(render()),
    change(value: string) {
      const callback = field("input").onChange;
      if (typeof callback !== "function") throw new Error("Missing input callback");
      callback({ target: { value } });
    },
    async submit() {
      const callback = field("form").onSubmit;
      if (typeof callback !== "function") throw new Error("Missing submit callback");
      await callback({ preventDefault() {} });
    },
    expire(delay: number) {
      for (const timer of timers.values()) if (timer.delay === delay) timer.callback();
    },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
  };
}

test("approved default onboarding redirects home after GET without opening or saving the form", async () => {
  const f = fixture();
  f.render();
  await settle();
  expect(f.state.redirects).toEqual(["/"]);
  expect(elements(f.render()).some((element) => element.type === "form")).toBe(false);
  expect(f.state.calls.map((call) => call.method)).toEqual(["GET"]);
  expect(f.timers.size).toBe(0);
  f.unmount();
});

test("pending onboarding stays open and a valid save redirects only after a checked matching response", async () => {
  const f = fixture();
  f.state.identity = { username: null, needsOnboarding: true };
  f.render();
  await settle();
  expect(f.state.redirects).toEqual([]);
  expect(f.field("input").value).toBe("");
  f.change("River_Trail");
  await f.submit();
  expect(f.state.calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  expect(JSON.parse(f.state.calls[1].body ?? "")).toEqual({ username: "river_trail" });
  expect(f.state.redirects).toEqual(["/"]);
  expect(f.state.refreshes).toBe(1);
  expect(f.timers.size).toBe(0);
  f.unmount();
});

test("explicit edit keeps the approved name; unchanged normalized submissions never make a PUT", async () => {
  const unchanged = fixture(true);
  unchanged.render();
  await settle();
  expect(unchanged.state.redirects).toEqual([]);
  expect(unchanged.field("input").value).toBe("river_walker");
  unchanged.change("RIVER_WALKER");
  await unchanged.submit();
  expect(unchanged.state.calls.map((call) => call.method)).toEqual(["GET"]);
  expect(unchanged.state.redirects).toEqual(["/"]);
  unchanged.unmount();

  const changed = fixture(true);
  changed.render();
  await settle();
  changed.change("new_walker");
  await changed.submit();
  expect(changed.state.calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  expect(changed.state.redirects).toEqual(["/"]);
  changed.unmount();
});

test("malformed, inconsistent or expanded GET responses cannot populate approved identity or redirect", async () => {
  for (const identity of [
    {}, { username: 123, needsOnboarding: false }, { username: null, needsOnboarding: false },
    { username: "river_walker", needsOnboarding: true }, { username: "Private Real Name", needsOnboarding: false },
    { username: "river_walker", needsOnboarding: false, email: "PRIVATE" },
  ]) {
    const f = fixture();
    f.state.identity = identity;
    f.render();
    await settle();
    expect(f.state.redirects).toEqual([]);
    expect(f.field("input").value).toBe("");
    expect(f.markup()).toContain("invalid response");
    expect(f.markup()).not.toContain("PRIVATE");
    f.unmount();
  }
});

test("malformed or mismatched save responses never become success or expose arbitrary error objects", async () => {
  for (const saved of [{}, { username: null, needsOnboarding: true }, { username: "other_name", needsOnboarding: false }]) {
    const f = fixture(true);
    f.render();
    await settle();
    f.state.saveResponse = saved;
    f.change("new_walker");
    await f.submit();
    expect(f.state.redirects).toEqual([]);
    expect(f.markup()).toContain("invalid response");
    expect(f.field("button").disabled).toBe(false);
    f.unmount();
  }
  const f = fixture();
  f.state.status = 503;
  f.state.identity = { error: { secret: "PRIVATE" } };
  f.render();
  await settle();
  expect(f.markup()).toContain("Could not process your username request");
  expect(f.markup()).not.toContain("PRIVATE");
  f.unmount();
});

test("load deadline bounds cookie transport and JSON parsing without a later redirect", async () => {
  for (const hang of ["fetch", "json"] as const) {
    const f = fixture();
    f.state.hang = hang;
    f.render();
    await settle();
    expect([...f.timers.values()].map((timer) => timer.delay)).toEqual([10_000]);
    f.expire(10_000);
    await settle();
    expect(f.markup()).toContain("Loading your username timed out");
    expect(f.state.redirects).toEqual([]);
    expect(f.state.calls[0].signal.aborted).toBe(true);
    expect(f.timers.size).toBe(0);
    f.unmount();
  }
});

test("save has a 20-second deadline and no retry; unmount aborts work without navigation", async () => {
  const f = fixture(true);
  f.render();
  await settle();
  f.change("new_walker");
  f.state.hang = "fetch";
  const saving = f.submit();
  await settle();
  expect([...f.timers.values()].map((timer) => timer.delay)).toEqual([20_000]);
  f.expire(20_000);
  await saving;
  expect(f.markup()).toContain("Reload your account before trying again");
  expect(f.state.calls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  expect(f.state.calls[1].signal.aborted).toBe(true);
  expect(f.state.redirects).toEqual([]);
  expect(f.field("button").disabled).toBe(false);
  f.unmount();

  const loading = fixture();
  loading.state.hang = "fetch";
  loading.render();
  await settle();
  loading.unmount();
  await settle();
  expect(loading.state.calls[0].signal.aborted).toBe(true);
  expect(loading.state.redirects).toEqual([]);
  expect(loading.timers.size).toBe(0);
});

test("only exact edit=1 enables edit mode and the account menu links to it explicitly", async () => {
  const Form = () => null;
  const rt = policyRuntime({
    "@/modules/auth/components/UsernameForm": { UsernameForm: Form },
    "@/modules/seo/policy": { PRIVATE_ROBOTS: { index: false, follow: false } },
    react: { ...React, useState: (value: unknown) => [value === false ? true : value, () => {}], useEffect: () => {} },
    "next/link": "a",
    "../lib/session": {},
  });
  const { default: Page } = rt.load<typeof import("../src/app/auth/username/page")>("src/app/auth/username/page.tsx");
  for (const edit of [undefined, "1", "true", ["1"]]) {
    const page = await Page({ searchParams: Promise.resolve({ edit }) });
    expect(elements(page).find((element) => element.type === Form)?.props.edit).toBe(edit === "1");
  }
  const { AccountMenu } = rt.load<typeof import("../src/modules/auth/components/AccountMenu")>("src/modules/auth/components/AccountMenu.tsx");
  expect(elements(AccountMenu()).find((element) => element.props.href === "/auth/username?edit=1")).toBeDefined();
});
