FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y \
       chromium \
       ca-certificates \
       fonts-liberation \
       libnss3 \
       libatk-bridge2.0-0 \
       libgtk-3-0 \
       libxss1 \
       libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

COPY package.json ./

RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
