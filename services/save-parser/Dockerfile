FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY services/save-parser/PocketMonsterBrawl.SaveParser.csproj services/save-parser/
RUN dotnet restore services/save-parser/PocketMonsterBrawl.SaveParser.csproj
COPY services/save-parser services/save-parser
RUN dotnet publish services/save-parser/PocketMonsterBrawl.SaveParser.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /out ./
ENV PARSER_URLS=http://0.0.0.0:3002
EXPOSE 3002
ENTRYPOINT ["dotnet", "PocketMonsterBrawl.SaveParser.dll"]
