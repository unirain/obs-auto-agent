# Build from the repository root: docker build -f agents/reading/tools/Dockerfile .
# Runtime packages are installed at image build time, never from article commands.
FROM node:24.10.0-bookworm-slim@sha256:b8d2197aff9129d16c801a3e3e1b2a873c4946480f5a310f38056df2268c38d9
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-cairo python3-cairosvg python3-pil chromium librsvg2-bin \
    poppler-utils fonts-noto-cjk fonts-noto-color-emoji ca-certificates git \
    && dpkg-query -W > /opt/reading-system-packages.txt \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/reading
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY agents/reading agents/reading
RUN npm run build
# The controller owns credentials; tools use docker --network none and never receive its env.
RUN useradd --create-home --uid 10001 reading
USER reading
ENV LANG=C.UTF-8 CHROMIUM_EXECUTABLE=/usr/bin/chromium
ENTRYPOINT ["node", "dist/agents/reading/src/cli.js"]
