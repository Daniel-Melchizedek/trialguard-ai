using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace FreeTrialApp.Pages;

public class ThankYouModel : PageModel
{
    public DateTime TrialEndsAtUtc { get; private set; }
    public string FirstName { get; private set; } = string.Empty;

    public IActionResult OnGet(string? firstName, string? expires)
    {
        if (string.IsNullOrEmpty(expires))
            return RedirectToPage("/Index");

        if (!DateTime.TryParse(expires, null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed))
            return RedirectToPage("/Index");

        TrialEndsAtUtc = parsed;
        FirstName = firstName ?? string.Empty;
        return Page();
    }
}
