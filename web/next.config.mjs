/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 엔진 types/ 는 import type 으로만 쓰므로 (런타임 코드 0) 트랜스파일 불필요.
  // 그래도 ../src 밖 파일을 추적할 수 있게 외부 디렉터리 추적을 허용.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
