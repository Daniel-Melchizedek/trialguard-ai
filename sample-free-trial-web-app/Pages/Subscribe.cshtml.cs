using FreeTrialApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.ComponentModel.DataAnnotations;

namespace FreeTrialApp.Pages;

public class SubscribeModel : PageModel
{
    private readonly SubscriptionService _subscriptionService;

    public SubscribeModel(SubscriptionService subscriptionService)
    {
        _subscriptionService = subscriptionService;
    }

    [BindProperty]
    public InputModel Input { get; set; } = new();

    public class InputModel
    {
        [Required(ErrorMessage = "First name is required.")]
        [StringLength(50, ErrorMessage = "First name cannot exceed 50 characters.")]
        [Display(Name = "First Name")]
        public string FirstName { get; set; } = string.Empty;

        [Required(ErrorMessage = "Last name is required.")]
        [StringLength(50, ErrorMessage = "Last name cannot exceed 50 characters.")]
        [Display(Name = "Last Name")]
        public string LastName { get; set; } = string.Empty;

        [Required(ErrorMessage = "Email address is required.")]
        [EmailAddress(ErrorMessage = "Please enter a valid email address.")]
        [StringLength(200, ErrorMessage = "Email cannot exceed 200 characters.")]
        [Display(Name = "Email Address")]
        public string Email { get; set; } = string.Empty;
    }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        if (await _subscriptionService.IsEmailAlreadyRegisteredAsync(Input.Email))
        {
            ModelState.AddModelError("Input.Email", "This email is already registered for a trial.");
            return Page();
        }

        var subscription = await _subscriptionService.AddSubscriptionAsync(Input.FirstName, Input.LastName, Input.Email);

        return RedirectToPage("/ThankYou", new
        {
            firstName = Input.FirstName,
            expires = subscription.TrialEndsAtUtc.ToString("O")
        });
    }
}
