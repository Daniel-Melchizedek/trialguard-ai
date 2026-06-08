namespace FreeTrialApp.Models;

public class TrialSubscription
{
    public Guid Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public DateTime SubscribedAtUtc { get; set; }
    public DateTime TrialEndsAtUtc { get; set; }
    public bool IsCancelled { get; set; }
    public DateTime? CancelledAtUtc { get; set; }

    public bool IsExpired => !IsCancelled && DateTime.UtcNow > TrialEndsAtUtc;
    public bool IsActive  => !IsCancelled && !IsExpired;
}
