import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useForm } from "react-hook-form"

import { Form, FormItem, FormLabel } from "./form"

describe("form field context", () => {
  it("throws a clear error when a form label is outside FormField", () => {
    function FormWithoutField() {
      const methods = useForm<{ name: string }>()

      return (
        <Form {...methods}>
          <FormItem>
            <FormLabel>Name</FormLabel>
          </FormItem>
        </Form>
      )
    }

    expect(() => render(<FormWithoutField />)).toThrow(
      "useFormField should be used within <FormField>"
    )
  })
})
