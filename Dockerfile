# Official Playwright image — includes Chromium + all system deps pre-installed
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Install deps (better layer caching — deps before source)
COPY package*.json ./
RUN npm ci

# Copy source and build TypeScript
COPY . .
RUN npm run build
RUN npx playwright install chromium

ENV PORT=3005
ENV NODE_ENV=production
# Tell Playwright to use the bundled Chromium inside the official image
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3005

CMD ["node", "dist/server.js"]
