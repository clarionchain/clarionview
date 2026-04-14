FROM node:22-slim AS base
RUN apt-get update \
    && apt-get install -y git ca-certificates --no-install-recommends \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /quartz

# Clone Quartz v4 at a pinned commit for reproducibility
RUN git clone --depth=1 --branch v4 https://github.com/jackyzha0/quartz.git . \
    && npm install

# Copy our custom config (overrides Quartz defaults)
COPY quartz.config.ts ./quartz.config.ts
COPY quartz.layout.ts ./quartz.layout.ts

# Placeholder content so Quartz can start before first intel run
RUN mkdir -p /quartz/content && \
    echo '---' > /quartz/content/index.md && \
    echo 'title: Bitcoin Intelligence' >> /quartz/content/index.md && \
    echo '---' >> /quartz/content/index.md && \
    echo '' >> /quartz/content/index.md && \
    echo '# Bitcoin Intelligence' >> /quartz/content/index.md && \
    echo '' >> /quartz/content/index.md && \
    echo 'Knowledge graph is generating. The daily pipeline runs at 03:00 UTC.' >> /quartz/content/index.md

EXPOSE 8080

# Start Quartz in watch+serve mode so it rebuilds when content changes
CMD ["npx", "quartz", "build", "--serve", "--port", "8080"]
