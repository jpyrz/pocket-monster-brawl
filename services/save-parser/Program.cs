using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using PKHeX.Core;

const int FireRedSaveSize = SaveUtil.SIZE_G3RAW;
const string ParserVersion = "firered-pkhex-26.8.26-v1";

var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    WriteIndented = false,
};

if (args is ["--parse", var path])
{
    var data = await File.ReadAllBytesAsync(path);
    var parsed = FireRedParser.Parse(data, ParserVersion);
    Console.WriteLine(JsonSerializer.Serialize(parsed, jsonOptions));
    return;
}

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(Environment.GetEnvironmentVariable("PARSER_URLS") ?? "http://127.0.0.1:3002");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = FireRedSaveSize);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

var app = builder.Build();
app.MapGet("/health", () => Results.Ok(new { service = "pmb-save-parser", parserVersion = ParserVersion }));
app.MapPost("/parse/fire-red", async (HttpRequest request) =>
{
    if (request.ContentLength is not FireRedSaveSize)
        return Results.BadRequest(new { error = "FireRed imports must be a 128 KiB raw GBA save." });

    await using var buffer = new MemoryStream(FireRedSaveSize);
    await request.Body.CopyToAsync(buffer, request.HttpContext.RequestAborted);
    var data = buffer.ToArray();
    if (data.Length != FireRedSaveSize)
        return Results.BadRequest(new { error = "The uploaded save ended before 128 KiB could be read." });

    try
    {
        return Results.Ok(FireRedParser.Parse(data, ParserVersion));
    }
    catch (SaveParseException error)
    {
        return Results.BadRequest(new { error = error.Message });
    }
});

await app.RunAsync();

static class FireRedParser
{
    public static ParsedSave Parse(byte[] data, string parserVersion)
    {
        if (data.Length != SaveUtil.SIZE_G3RAW)
            throw new SaveParseException("FireRed imports must be a 128 KiB raw GBA save.");

        var sav = SaveUtil.GetSaveFile(data);
        if (sav is not SAV3FRLG fireRedLeafGreen)
            throw new SaveParseException("PKHeX did not recognize this as a FireRed or LeafGreen save.");

        SaveLanguage.TryRevise(sav);
        var versionWasInferred = fireRedLeafGreen.Version is GameVersion.FRLG;
        if (versionWasInferred)
            fireRedLeafGreen.ResetPersonal(GameVersion.FR);
        else if (fireRedLeafGreen.Version is not GameVersion.FR)
            throw new SaveParseException($"This pilot accepts FireRed saves; PKHeX detected {fireRedLeafGreen.Version}.");

        var strings = GameInfo.GetStrings("en");
        var pokemon = new List<ParsedPokemon>();
        for (var slot = 0; slot < sav.PartyData.Count; slot++)
        {
            var entity = sav.PartyData[slot];
            if (entity.Species != 0)
                pokemon.Add(ParsePokemon(entity, strings, new SourceSlot("party", null, null, slot + 1)));
        }

        var boxData = sav.BoxData;
        for (var index = 0; index < boxData.Count; index++)
        {
            var entity = boxData[index];
            if (entity.Species == 0) continue;
            var box = index / sav.BoxSlotCount;
            var slot = index % sav.BoxSlotCount;
            var boxName = sav is IBoxDetailNameRead names ? names.GetBoxName(box) : $"Box {box + 1}";
            pokemon.Add(ParsePokemon(entity, strings, new SourceSlot("box", box + 1, boxName, slot + 1)));
        }

        var sha256 = Convert.ToHexStringLower(SHA256.HashData(data));
        var warnings = new List<string>();
        if (versionWasInferred)
            warnings.Add("The Gen III save format identifies FireRed/LeafGreen jointly; this import uses the selected FireRed profile.");
        if (!sav.ChecksumsValid)
            warnings.Add("PKHeX detected one or more invalid save-block checksums.");
        if (pokemon.Count == 0)
            warnings.Add("No non-empty Pokémon were found in the party or PC boxes.");

        return new ParsedSave(
            parserVersion,
            sha256,
            data.Length,
            "Pokemon FireRed",
            fireRedLeafGreen.Version.ToString(),
            ((LanguageID)sav.Language).ToString(),
            sav.ChecksumsValid,
            new ParsedTrainer(sav.OT, sav.TID16, sav.SID16, sav.PlayTimeString),
            pokemon,
            warnings
        );
    }

    private static ParsedPokemon ParsePokemon(PKM entity, GameStrings strings, SourceSlot source)
    {
        var stats = entity.GetStats(entity.PersonalInfo);
        var storedStats = entity.PartyStatsPresent
            ? new PokemonStats(entity.Stat_HPMax, entity.Stat_ATK, entity.Stat_DEF, entity.Stat_SPA, entity.Stat_SPD, entity.Stat_SPE)
            : null;
        var legality = new LegalityAnalysis(entity);
        var rawFingerprint = Convert.ToHexStringLower(SHA256.HashData(entity.Data[..entity.SIZE_STORED]))[..16];
        var heldItem = SafeGet(strings.GetItemStrings(entity.Context, entity.Version), entity.HeldItem);

        return new ParsedPokemon(
            rawFingerprint,
            source,
            entity.Species,
            SafeGet(strings.specieslist, entity.Species),
            entity.Nickname,
            entity.CurrentLevel,
            SafeGet(GameInfo.GenderSymbolASCII, entity.Gender),
            entity.IsShiny,
            entity.IsEgg,
            entity.Nature.ToString(),
            SafeGet(strings.abilitylist, entity.Ability),
            entity.HeldItem == 0 ? null : heldItem,
            entity.CurrentFriendship,
            entity.EXP,
            new PokemonMoves(
                ParseMove(1, entity.Move1, entity.Move1_PP, entity.Move1_PPUps, strings),
                ParseMove(2, entity.Move2, entity.Move2_PP, entity.Move2_PPUps, strings),
                ParseMove(3, entity.Move3, entity.Move3_PP, entity.Move3_PPUps, strings),
                ParseMove(4, entity.Move4, entity.Move4_PP, entity.Move4_PPUps, strings)
            ).AsList(),
            new PokemonStats(stats[0], stats[1], stats[2], stats[4], stats[5], stats[3]),
            storedStats,
            new PokemonStats(entity.IV_HP, entity.IV_ATK, entity.IV_DEF, entity.IV_SPA, entity.IV_SPD, entity.IV_SPE),
            new PokemonStats(entity.EV_HP, entity.EV_ATK, entity.EV_DEF, entity.EV_SPA, entity.EV_SPD, entity.EV_SPE),
            entity.Valid,
            legality.Valid,
            legality.Valid ? null : legality.Report(false)
        );
    }

    private static ParsedMove? ParseMove(int slot, ushort id, int pp, int ppUps, GameStrings strings) =>
        id == 0 ? null : new ParsedMove(slot, id, SafeGet(strings.movelist, id), pp, ppUps);

    private static string SafeGet(IReadOnlyList<string> values, int index) =>
        (uint)index < values.Count ? values[index] : $"Unknown ({index})";
}

sealed class SaveParseException(string message) : Exception(message);

sealed record ParsedSave(
    string ParserVersion,
    string Sha256,
    int Size,
    string Game,
    string GameVersion,
    string Language,
    bool ChecksumsValid,
    ParsedTrainer Trainer,
    IReadOnlyList<ParsedPokemon> Pokemon,
    IReadOnlyList<string> Warnings
);

sealed record ParsedTrainer(string Name, ushort Tid, ushort Sid, string PlayTime);
sealed record SourceSlot(string Kind, int? Box, string? BoxName, int Slot);
sealed record ParsedMove(int Slot, ushort Id, string Name, int Pp, int PpUps);
sealed record PokemonStats(int Hp, int Attack, int Defense, int SpecialAttack, int SpecialDefense, int Speed);
sealed record ParsedPokemon(
    string Fingerprint,
    SourceSlot Source,
    ushort SpeciesId,
    string Species,
    string Nickname,
    byte Level,
    string Gender,
    bool Shiny,
    bool Egg,
    string Nature,
    string Ability,
    string? HeldItem,
    byte Friendship,
    uint Experience,
    IReadOnlyList<ParsedMove> Moves,
    PokemonStats Stats,
    PokemonStats? StoredStats,
    PokemonStats Ivs,
    PokemonStats Evs,
    bool EntityValid,
    bool LegalityValid,
    string? LegalityReport
);

sealed record PokemonMoves(ParsedMove? First, ParsedMove? Second, ParsedMove? Third, ParsedMove? Fourth)
{
    public IReadOnlyList<ParsedMove> AsList() => new ParsedMove?[] { First, Second, Third, Fourth }.OfType<ParsedMove>().ToArray();
}
