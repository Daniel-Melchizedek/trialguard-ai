using System.Text.Json;
using FreeTrialApp.Models;

namespace FreeTrialApp.Services;

public class SubscriptionService
{
    private readonly string _filePath;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public SubscriptionService(IWebHostEnvironment env)
    {
        var dataDir = Path.Combine(env.ContentRootPath, "Data");
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(dataDir, "subscriptions.json");
    }

    public async Task<bool> IsEmailAlreadyRegisteredAsync(string email)
    {
        var subscriptions = await ReadAllAsync();
        return subscriptions.Any(s => s.Email.Equals(email, StringComparison.OrdinalIgnoreCase));
    }

    public async Task<TrialSubscription> AddSubscriptionAsync(string firstName, string lastName, string email)
    {
        var subscription = new TrialSubscription
        {
            Id = Guid.NewGuid(),
            FirstName = firstName,
            LastName = lastName,
            Email = email,
            SubscribedAtUtc = DateTime.UtcNow,
            TrialEndsAtUtc = DateTime.UtcNow.AddDays(2)
        };

        await _lock.WaitAsync();
        try
        {
            var subscriptions = await ReadAllAsync();
            subscriptions.Add(subscription);
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(subscriptions, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally
        {
            _lock.Release();
        }

        return subscription;
    }

    private async Task<List<TrialSubscription>> ReadAllAsync()
    {
        if (!File.Exists(_filePath))
            return new List<TrialSubscription>();

        var json = await File.ReadAllTextAsync(_filePath);
        if (string.IsNullOrWhiteSpace(json))
            return new List<TrialSubscription>();

        return JsonSerializer.Deserialize<List<TrialSubscription>>(json) ?? new List<TrialSubscription>();
    }
}
