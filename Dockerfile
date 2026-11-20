# build environment
FROM node:22-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# production environment
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/serverSecurity.ts ./serverSecurity.ts
COPY --from=build /app/followUpEngine.ts ./followUpEngine.ts
COPY --from=build /app/prescriptionRecipe.ts ./prescriptionRecipe.ts

COPY --from=build /app/prescriptionSearch.ts ./prescriptionSearch.ts
COPY --from=build /app/prescriptionRecommendations.ts ./prescriptionRecommendations.ts
COPY --from=build /app/prescriptionSynthesisSchema.ts ./prescriptionSynthesisSchema.ts
COPY --from=build /app/guideSuggestions.ts ./guideSuggestions.ts
COPY --from=build /app/bookGuide.ts ./bookGuide.ts
COPY --from=build /app/privateBookCorpus.ts ./privateBookCorpus.ts
COPY --from=build /app/tsumuraMonographs.ts ./tsumuraMonographs.ts
COPY --from=build /app/clinicPrescriptionGuidance.ts ./clinicPrescriptionGuidance.ts

ENV NODE_ENV=production

EXPOSE 8080
CMD ["npm", "run", "start"]
