using System.ComponentModel.DataAnnotations;
using FreeTrialApp.Models;
using FreeTrialApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace FreeTrialApp.Pages;

public class CancelModel : PageModel
{
    private readonly SubscriptionService _subscriptionService;

    public CancelModel(SubscriptionService subscriptionService)
    {
        _subscriptionService = subscriptionService;
    }

    [BindProperty]
    [Required(ErrorMessage = "Email address is required.")]
    [EmailAddress(ErrorMessage = "Enter a valid email address.")]
    public string Email { get; set; } = string.Empty;

    public TrialSubscription? Subscription { get; private set; }
    public bool ShowConfirmation { get; private set; }
    public bool ShowSuccess { get; private set; }
    public string? LookupError { get; private set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostLookupAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        Subscription = await _subscriptionService.GetSubscriptionByEmailAsync(Email);

        if (Subscription is null)
        {
            LookupError = "No trial subscription was found for that email address.";
            return Page();
        }

        ShowConfirmation = true;
        return Page();
    }

    public async Task<IActionResult> OnPostCancelAsync()
    {
        if (string.IsNullOrWhiteSpace(Email))
        {
            LookupError = "Something went wrong. Please try again.";
            return Page();
        }

        var sub = await _subscriptionService.CancelSubscriptionAsync(Email);

        if (sub is null)
        {
            LookupError = "No trial subscription was found for that email address.";
            return Page();
        }

        Subscription = sub;
        ShowSuccess = true;
        return Page();
    }
}
