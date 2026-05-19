FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install

COPY . .

RUN npm run build --workspace @domain-chat/api

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "@domain-chat/api"]

