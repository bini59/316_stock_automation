/**
 * 백테스트 데이터셋 로컬 캐시 (TODO 3.4).
 *
 * 반복 백테스트 속도를 위해 적재 결과를 캐시한다. 결정적 키(심볼+범위)로
 * 저장/조회. 캐시는 BarLoader를 감싸는 데코레이터로 동작 — 적재 추상화를
 * 깨지 않는다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PriceSeries } from "../types/market";
import type { BarLoader } from "./loader";

export interface CacheStore {
  get(key: string): Promise<PriceSeries | undefined>;
  set(key: string, value: PriceSeries): Promise<void>;
}

/** 메모리 캐시(테스트·단일 프로세스용) */
export class MemoryCache implements CacheStore {
  private readonly map = new Map<string, PriceSeries>();
  async get(key: string): Promise<PriceSeries | undefined> {
    return this.map.get(key);
  }
  async set(key: string, value: PriceSeries): Promise<void> {
    this.map.set(key, value);
  }
}

/** 파일 캐시(.cache/ JSON). gitignore에 .cache/ 포함됨. */
export class FileCache implements CacheStore {
  constructor(private readonly dir: string = ".cache") {}

  private file(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  async get(key: string): Promise<PriceSeries | undefined> {
    try {
      const text = await readFile(this.file(key), "utf8");
      return JSON.parse(text) as PriceSeries;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: PriceSeries): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify(value), "utf8");
  }
}

/** 캐시 키 생성(심볼 단위 전체 히스토리) */
export function cacheKey(symbol: string): string {
  return `bars_${symbol}`;
}

/**
 * BarLoader를 캐시로 감싸는 데코레이터. 캐시 히트면 소스 미접근.
 */
export class CachedBarLoader implements BarLoader {
  constructor(
    private readonly inner: BarLoader,
    private readonly store: CacheStore,
  ) {}

  async load(symbol: string): Promise<PriceSeries> {
    const key = cacheKey(symbol);
    const cached = await this.store.get(key);
    if (cached) return cached;
    const fresh = await this.inner.load(symbol);
    await this.store.set(key, fresh);
    return fresh;
  }
}
