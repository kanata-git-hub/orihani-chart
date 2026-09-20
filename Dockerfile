# build environment
FROM node:22-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# production environment
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/serverSecurity.ts ./serverSecurity.ts

ENV NODE_ENV=production

EXPOSE 8080
CMD ["npm", "run", "start"]
