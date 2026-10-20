"""Navigate the current tap-answer onboarding UI without bypassing onboarding."""
async def questionnaire(page, goal, area="Learning a skill or language"):
    qn = page.get_by_test_id("onboarding-questionnaire")
    await qn.wait_for(timeout=30000)
    answers = [area, "Monday to Friday, 9am to 5pm", "7:00am", "11:00pm",
               "4 sessions a week", "60 minutes", "Weekday evenings", "None",
               "Not knowing where to start", "Evening"]
    if area == "Fitness and sport":
        answers.append("None")
    answers.append("A qualification or new expertise" if area != "Fitness and sport" else "Better health and wellbeing")
    for answer in answers:
        await qn.get_by_role("button", name=answer, exact=True).click()
        await qn.get_by_role("button", name="Next", exact=True).click()
    await page.get_by_label("Main goal").fill(goal)
    await page.get_by_role("button", name="Review my answers").click()
    review = page.get_by_role("button", name="Looks right")
    await review.wait_for(timeout=180000)
    if await review.is_disabled():
        await page.get_by_text("Use sensible defaults I can change").click()
    await review.click()
