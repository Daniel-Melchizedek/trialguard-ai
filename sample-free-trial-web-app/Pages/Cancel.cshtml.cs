using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace FreeTrialApp.Pages;

public class CancelModel : PageModel
{
    // Dummy cancellation flow: no email required.
    //   GET /Cancel            → confirmation prompt
    //   POST (Cancel handler)  → success message
    public bool ShowSuccess { get; private set; }

    public void OnGet() { }

    public IActionResult OnPostCancel()
    {
        ShowSuccess = true;
        return Page();
    }
}
