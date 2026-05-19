FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace @domain-chat/web

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0"]
