FROM dart:stable AS build
WORKDIR /app
COPY pubspec.yaml pubspec.lock* ./
RUN dart pub get
COPY . .
RUN dart pub get --offline
RUN dart compile exe bin/server.dart -o bin/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/bin/server /app/server
ENV PORT=3002
ENV GOOGLE_CLOUD_PROJECT=my-socitea
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json
EXPOSE 3002
CMD ["/app/server"]
